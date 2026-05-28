"""Trades between league members. Proposer specifies what each side sends;
recipient accepts or declines. Acceptance atomically swaps asset ownership and
transfers any cash legs."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyLeague,
    FantasyLeagueMember,
    FantasySeason,
    FantasyTrade,
    FantasyTradeAsset,
)

VALID_DIRECTIONS = {"proposer_sends", "recipient_sends"}


def _require_member(
    db: Session, league_id: int, user_id: str
) -> FantasyLeagueMember:
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="League not found.")
    return member


def _serialize_trade(
    trade: FantasyTrade, legs: list[FantasyTradeAsset]
) -> dict:
    return {
        "id": trade.id,
        "league_id": trade.league_id,
        "season_id": trade.season_id,
        "proposer_id": trade.proposer_id,
        "recipient_id": trade.recipient_id,
        "status": trade.status,
        "message": trade.message,
        "created_at": trade.created_at,
        "resolved_at": trade.resolved_at,
        "legs": [
            {
                "id": leg.id,
                "direction": leg.direction,
                "asset_id": leg.asset_id,
                "budget_amount": leg.budget_amount,
            }
            for leg in legs
        ],
    }


def propose_trade(
    db: Session,
    proposer_id: str,
    league_id: int,
    season_id: int,
    *,
    recipient_id: str,
    proposer_assets: list[int],
    recipient_assets: list[int],
    proposer_cash: int = 0,
    recipient_cash: int = 0,
    message: str | None = None,
) -> dict:
    if proposer_id == recipient_id:
        raise HTTPException(status_code=422, detail="Cannot trade with yourself.")

    proposer = _require_member(db, league_id, proposer_id)
    recipient = _require_member(db, league_id, recipient_id)

    if not (proposer_assets or recipient_assets or proposer_cash or recipient_cash):
        raise HTTPException(status_code=422, detail="Trade is empty.")

    if proposer_cash < 0 or recipient_cash < 0:
        raise HTTPException(status_code=422, detail="Cash amounts must be >= 0.")
    if proposer_cash > proposer.budget_remaining:
        raise HTTPException(
            status_code=409, detail="You don't have enough budget to send."
        )
    if recipient_cash > recipient.budget_remaining:
        raise HTTPException(
            status_code=409,
            detail="Recipient doesn't have enough budget for what they'd send.",
        )

    season = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.id == season_id, FantasySeason.league_id == league_id
        )
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")

    _validate_assets_owned_by(
        db, proposer_assets, owner_id=proposer_id, league_id=league_id, season_id=season_id
    )
    _validate_assets_owned_by(
        db, recipient_assets, owner_id=recipient_id, league_id=league_id, season_id=season_id
    )

    trade = FantasyTrade(
        league_id=league_id,
        season_id=season_id,
        proposer_id=proposer_id,
        recipient_id=recipient_id,
        status="pending",
        message=message,
    )
    db.add(trade)
    db.flush()

    legs: list[FantasyTradeAsset] = []
    for aid in proposer_assets:
        legs.append(
            FantasyTradeAsset(
                trade_id=trade.id, direction="proposer_sends", asset_id=aid
            )
        )
    for aid in recipient_assets:
        legs.append(
            FantasyTradeAsset(
                trade_id=trade.id, direction="recipient_sends", asset_id=aid
            )
        )
    if proposer_cash:
        legs.append(
            FantasyTradeAsset(
                trade_id=trade.id,
                direction="proposer_sends",
                budget_amount=proposer_cash,
            )
        )
    if recipient_cash:
        legs.append(
            FantasyTradeAsset(
                trade_id=trade.id,
                direction="recipient_sends",
                budget_amount=recipient_cash,
            )
        )
    for leg in legs:
        db.add(leg)

    db.commit()
    db.refresh(trade)
    return _serialize_trade(trade, legs)


def _validate_assets_owned_by(
    db: Session,
    asset_ids: list[int],
    *,
    owner_id: str,
    league_id: int,
    season_id: int,
) -> None:
    if not asset_ids:
        return
    rows = (
        db.query(FantasyAsset)
        .filter(
            FantasyAsset.id.in_(asset_ids),
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.owner_user_id == owner_id,
            FantasyAsset.dropped_at.is_(None),
        )
        .all()
    )
    if len(rows) != len(asset_ids):
        raise HTTPException(
            status_code=409,
            detail="One or more assets aren't on the expected roster.",
        )


def accept_trade(db: Session, user_id: str, trade_id: int) -> dict:
    trade = db.get(FantasyTrade, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found.")
    if trade.recipient_id != user_id:
        raise HTTPException(
            status_code=403, detail="Only the recipient can accept."
        )
    if trade.status != "pending":
        raise HTTPException(status_code=409, detail="Trade is no longer pending.")

    legs = (
        db.query(FantasyTradeAsset)
        .filter(FantasyTradeAsset.trade_id == trade.id)
        .all()
    )

    proposer_member = _require_member(db, trade.league_id, trade.proposer_id)
    recipient_member = _require_member(db, trade.league_id, trade.recipient_id)

    cash_proposer_sends = 0
    cash_recipient_sends = 0
    asset_legs: list[FantasyTradeAsset] = []
    for leg in legs:
        if leg.asset_id is not None:
            asset_legs.append(leg)
        elif leg.budget_amount:
            if leg.direction == "proposer_sends":
                cash_proposer_sends += leg.budget_amount
            else:
                cash_recipient_sends += leg.budget_amount

    if proposer_member.budget_remaining < cash_proposer_sends:
        raise HTTPException(
            status_code=409, detail="Proposer no longer has the required budget."
        )
    if recipient_member.budget_remaining < cash_recipient_sends:
        raise HTTPException(
            status_code=409, detail="You no longer have the required budget."
        )

    # Re-verify assets are still on the original owner's roster.
    for leg in asset_legs:
        asset = db.get(FantasyAsset, leg.asset_id)
        if not asset or asset.dropped_at is not None:
            raise HTTPException(
                status_code=409,
                detail="One of the traded assets is no longer available.",
            )
        expected_owner = (
            trade.proposer_id
            if leg.direction == "proposer_sends"
            else trade.recipient_id
        )
        if asset.owner_user_id != expected_owner:
            raise HTTPException(
                status_code=409,
                detail="A traded asset has changed hands since the proposal.",
            )

    # Swap.
    for leg in asset_legs:
        asset = db.get(FantasyAsset, leg.asset_id)
        if leg.direction == "proposer_sends":
            asset.owner_user_id = trade.recipient_id
        else:
            asset.owner_user_id = trade.proposer_id

    proposer_member.budget_remaining -= cash_proposer_sends
    proposer_member.budget_remaining += cash_recipient_sends
    recipient_member.budget_remaining -= cash_recipient_sends
    recipient_member.budget_remaining += cash_proposer_sends

    trade.status = "accepted"
    trade.resolved_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(trade)
    return _serialize_trade(trade, legs)


def decline_trade(db: Session, user_id: str, trade_id: int) -> dict:
    trade = db.get(FantasyTrade, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found.")
    if user_id not in (trade.recipient_id, trade.proposer_id):
        raise HTTPException(status_code=403, detail="Not your trade.")
    if trade.status != "pending":
        raise HTTPException(status_code=409, detail="Trade is no longer pending.")
    trade.status = "declined" if user_id == trade.recipient_id else "cancelled"
    trade.resolved_at = datetime.now(timezone.utc)
    db.commit()
    legs = (
        db.query(FantasyTradeAsset)
        .filter(FantasyTradeAsset.trade_id == trade.id)
        .all()
    )
    return _serialize_trade(trade, legs)


def veto_trade(db: Session, user_id: str, trade_id: int) -> dict:
    trade = db.get(FantasyTrade, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found.")
    league = db.get(FantasyLeague, trade.league_id)
    if not league or league.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Only the league owner can veto.")
    if trade.status not in ("pending", "accepted"):
        raise HTTPException(status_code=409, detail="Trade cannot be vetoed now.")
    trade.status = "vetoed"
    trade.resolved_at = datetime.now(timezone.utc)
    db.commit()
    legs = (
        db.query(FantasyTradeAsset)
        .filter(FantasyTradeAsset.trade_id == trade.id)
        .all()
    )
    return _serialize_trade(trade, legs)


def list_all_trades(
    db: Session,
    actor_id: str,
    league_id: int,
    season_id: int,
    *,
    status: str | None = None,
) -> list[dict]:
    """League-wide trade list for the commissioner. Lets the owner see and
    veto trades they're not personally a party to."""
    league = db.get(FantasyLeague, league_id)
    if not league or league.owner_id != actor_id:
        raise HTTPException(status_code=403, detail="Owner only.")
    q = db.query(FantasyTrade).filter(
        FantasyTrade.league_id == league_id,
        FantasyTrade.season_id == season_id,
    )
    if status:
        q = q.filter(FantasyTrade.status == status)
    trades = q.order_by(FantasyTrade.created_at.desc()).all()
    if not trades:
        return []
    trade_ids = [t.id for t in trades]
    legs = (
        db.query(FantasyTradeAsset)
        .filter(FantasyTradeAsset.trade_id.in_(trade_ids))
        .all()
    )
    by_trade: dict[int, list[FantasyTradeAsset]] = {}
    for leg in legs:
        by_trade.setdefault(leg.trade_id, []).append(leg)
    return [_serialize_trade(t, by_trade.get(t.id, [])) for t in trades]


def list_my_trades(
    db: Session,
    user_id: str,
    league_id: int,
    season_id: int,
    *,
    status: str | None = None,
) -> list[dict]:
    _require_member(db, league_id, user_id)
    q = db.query(FantasyTrade).filter(
        FantasyTrade.league_id == league_id,
        FantasyTrade.season_id == season_id,
        (FantasyTrade.proposer_id == user_id)
        | (FantasyTrade.recipient_id == user_id),
    )
    if status:
        q = q.filter(FantasyTrade.status == status)
    trades = q.order_by(FantasyTrade.created_at.desc()).all()

    if not trades:
        return []
    trade_ids = [t.id for t in trades]
    legs = (
        db.query(FantasyTradeAsset)
        .filter(FantasyTradeAsset.trade_id.in_(trade_ids))
        .all()
    )
    by_trade: dict[int, list[FantasyTradeAsset]] = {}
    for leg in legs:
        by_trade.setdefault(leg.trade_id, []).append(leg)
    return [_serialize_trade(t, by_trade.get(t.id, [])) for t in trades]

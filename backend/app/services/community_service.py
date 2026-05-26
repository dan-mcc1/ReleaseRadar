"""Community (a.k.a. Groups) service — CRUD, membership, media, posts."""
import re
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_, func, desc, case, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.community import (
    Community,
    CommunityInvitation,
    CommunityMember,
    CommunityMedia,
    CommunityPost,
    CommunityReply,
    CommunityPostLike,
    CommunityReplyLike,
)
from app.models.movie import Movie
from app.models.show import Show
from app.services.media_upsert import populate_movie_full, ensure_show_in_db
from app.models.user import User


MAX_OWNED_PER_USER = 10
MAX_POST_LEN = 5000
MAX_REPLY_LEN = 2000

SLUG_RE = re.compile(r"^[a-z0-9-]+$")


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return s[:50] or secrets.token_hex(4)


def _unique_slug(db: Session, base: str) -> str:
    candidate = base
    suffix = 0
    while db.query(Community.id).filter(Community.slug == candidate).first():
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate


def _serialize_user(u: User | None) -> dict | None:
    if not u:
        return None
    return {"id": u.id, "username": u.username, "display_name": u.display_name}


def _serialize_community(c: Community, viewer_role: str | None = None) -> dict:
    members_can_edit = bool(c.members_can_edit_media)
    is_staff = viewer_role in ("owner", "admin")
    return {
        "id": c.id,
        "slug": c.slug,
        "name": c.name,
        "description": c.description,
        "banner_color": c.banner_color,
        "visibility": c.visibility,
        "is_featured": c.is_featured,
        "member_count": c.member_count,
        "created_at": c.created_at,
        "created_by": c.created_by,
        "viewer_role": viewer_role,
        "members_can_edit_media": members_can_edit,
        # Convenience for the UI — true when the viewer can add/remove titles.
        "viewer_can_edit_media": is_staff or (members_can_edit and viewer_role is not None),
    }


# ─── Community CRUD ─────────────────────────────────────────────────────────

def create_community(
    db: Session,
    user_id: str,
    name: str,
    description: str | None,
    visibility: str,
    banner_color: str | None,
) -> Community:
    name = (name or "").strip()
    if not (2 <= len(name) <= 80):
        raise HTTPException(status_code=422, detail="Name must be 2–80 characters.")
    if visibility not in ("public", "private"):
        raise HTTPException(status_code=422, detail="visibility must be public or private.")
    if description and len(description) > 1000:
        raise HTTPException(status_code=422, detail="Description must be 1000 characters or fewer.")

    owned = (
        db.query(func.count(CommunityMember.community_id))
        .filter(CommunityMember.user_id == user_id, CommunityMember.role == "owner")
        .scalar()
        or 0
    )
    if owned >= MAX_OWNED_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=f"You can own at most {MAX_OWNED_PER_USER} groups.",
        )

    slug = _unique_slug(db, _slugify(name))
    community = Community(
        slug=slug,
        name=name,
        description=(description or "").strip() or None,
        visibility=visibility,
        banner_color=banner_color,
        created_by=user_id,
        member_count=1,
    )
    db.add(community)
    db.flush()

    db.add(CommunityMember(community_id=community.id, user_id=user_id, role="owner"))
    db.commit()
    db.refresh(community)
    return community


def update_community(
    db: Session,
    user_id: str,
    community_id: int,
    name: str | None = None,
    description: str | None = None,
    visibility: str | None = None,
    banner_color: str | None = None,
    members_can_edit_media: bool | None = None,
) -> Community:
    c, role = _require_role(db, community_id, user_id, ("owner", "admin"))
    if name is not None:
        name = name.strip()
        if not (2 <= len(name) <= 80):
            raise HTTPException(status_code=422, detail="Name must be 2–80 characters.")
        c.name = name
    if description is not None:
        if len(description) > 1000:
            raise HTTPException(status_code=422, detail="Description too long.")
        c.description = description.strip() or None
    if visibility is not None:
        if visibility not in ("public", "private"):
            raise HTTPException(status_code=422, detail="Invalid visibility.")
        c.visibility = visibility
    if banner_color is not None:
        c.banner_color = banner_color or None
    if members_can_edit_media is not None:
        c.members_can_edit_media = bool(members_can_edit_media)
    db.commit()
    db.refresh(c)
    return c


def delete_community(db: Session, user_id: str, community_id: int) -> None:
    c, _ = _require_role(db, community_id, user_id, ("owner",))
    db.delete(c)
    db.commit()


def get_community_by_slug(db: Session, slug: str, viewer_id: str) -> dict:
    c = db.query(Community).filter(Community.slug == slug).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    role = _viewer_role(db, c.id, viewer_id)
    if c.visibility == "private" and role is None:
        # Only members can see a private group's details
        raise HTTPException(status_code=404, detail="Group not found.")
    return _serialize_community(c, viewer_role=role)


# ─── Discovery ──────────────────────────────────────────────────────────────

def list_communities(
    db: Session,
    viewer_id: str,
    q: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[dict]:
    """Browse public groups (plus any private ones the viewer belongs to)."""
    joined_select = select(CommunityMember.community_id).where(
        CommunityMember.user_id == viewer_id
    )
    query = db.query(Community).filter(
        or_(Community.visibility == "public", Community.id.in_(joined_select))
    )
    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(Community.name.ilike(pattern), Community.description.ilike(pattern))
        )
    rows = (
        query.order_by(desc(Community.is_featured), desc(Community.member_count), desc(Community.id))
        .offset(offset)
        .limit(limit)
        .all()
    )
    member_rows = (
        db.query(CommunityMember.community_id, CommunityMember.role)
        .filter(
            CommunityMember.user_id == viewer_id,
            CommunityMember.community_id.in_([c.id for c in rows]) if rows else False,
        )
        .all()
    )
    role_map = {r.community_id: r.role for r in member_rows}
    return [_serialize_community(c, viewer_role=role_map.get(c.id)) for c in rows]


def list_my_communities(db: Session, user_id: str) -> list[dict]:
    rows = (
        db.query(Community, CommunityMember.role)
        .join(CommunityMember, CommunityMember.community_id == Community.id)
        .filter(CommunityMember.user_id == user_id)
        .order_by(desc(CommunityMember.joined_at))
        .all()
    )
    return [_serialize_community(c, viewer_role=role) for c, role in rows]


# ─── Membership ────────────────────────────────────────────────────────────

def _viewer_role(db: Session, community_id: int, viewer_id: str | None) -> str | None:
    if not viewer_id:
        return None
    m = (
        db.query(CommunityMember)
        .filter(
            CommunityMember.community_id == community_id,
            CommunityMember.user_id == viewer_id,
        )
        .first()
    )
    return m.role if m else None


def _require_role(
    db: Session, community_id: int, user_id: str, allowed: tuple[str, ...]
) -> tuple[Community, str]:
    c = db.query(Community).filter(Community.id == community_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    role = _viewer_role(db, community_id, user_id)
    if role not in allowed:
        raise HTTPException(status_code=403, detail="You don't have permission to do that.")
    return c, role


def join_community(db: Session, user_id: str, community_id: int) -> dict:
    c = db.query(Community).filter(Community.id == community_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    if c.visibility != "public":
        raise HTTPException(status_code=403, detail="This group is invite-only.")
    existing = _viewer_role(db, community_id, user_id)
    if existing:
        return {"role": existing}

    try:
        db.add(CommunityMember(community_id=community_id, user_id=user_id, role="member"))
        c.member_count = (c.member_count or 0) + 1
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"role": "member"}
    return {"role": "member"}


def leave_community(db: Session, user_id: str, community_id: int) -> None:
    role = _viewer_role(db, community_id, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="You are not a member.")
    if role == "owner":
        # Owner can leave only if there are other admins/members who can be promoted
        other_owner = (
            db.query(CommunityMember)
            .filter(
                CommunityMember.community_id == community_id,
                CommunityMember.role == "owner",
                CommunityMember.user_id != user_id,
            )
            .first()
        )
        if not other_owner:
            raise HTTPException(
                status_code=400,
                detail="You're the only owner. Transfer ownership or delete the group first.",
            )

    db.query(CommunityMember).filter(
        CommunityMember.community_id == community_id,
        CommunityMember.user_id == user_id,
    ).delete()
    c = db.query(Community).filter(Community.id == community_id).first()
    if c:
        c.member_count = max(0, (c.member_count or 1) - 1)
    db.commit()


def list_members(db: Session, community_id: int, viewer_id: str) -> list[dict]:
    c = db.query(Community).filter(Community.id == community_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    if c.visibility == "private" and _viewer_role(db, community_id, viewer_id) is None:
        raise HTTPException(status_code=404, detail="Group not found.")
    role_order = case(
        (CommunityMember.role == "owner", 0),
        (CommunityMember.role == "admin", 1),
        else_=2,
    )
    rows = (
        db.query(CommunityMember, User)
        .join(User, User.id == CommunityMember.user_id)
        .filter(CommunityMember.community_id == community_id)
        .order_by(role_order, CommunityMember.joined_at)
        .all()
    )
    return [
        {
            "user": _serialize_user(u),
            "role": m.role,
            "joined_at": m.joined_at,
        }
        for m, u in rows
    ]


def invite_member(
    db: Session, inviter_id: str, community_id: int, username: str
) -> CommunityInvitation:
    """Owner/admin sends an invitation. The invitee must accept before becoming
    a member — this function creates a pending CommunityInvitation row.

    Returns the invitation object. The router fires email + push on the way
    out so notifications can stamp the invitation_id correctly.
    """
    c, _ = _require_role(db, community_id, inviter_id, ("owner", "admin"))
    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.id == inviter_id:
        raise HTTPException(status_code=400, detail="You can't invite yourself.")
    if _viewer_role(db, community_id, target.id):
        raise HTTPException(status_code=409, detail="That user is already a member.")

    existing = (
        db.query(CommunityInvitation)
        .filter(
            CommunityInvitation.community_id == community_id,
            CommunityInvitation.user_id == target.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="That user already has a pending invitation."
        )

    inv = CommunityInvitation(
        community_id=community_id,
        user_id=target.id,
        invited_by=inviter_id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


def respond_to_invitation(
    db: Session, user_id: str, invitation_id: int, accept: bool
) -> dict:
    """Invitee accepts (becomes a member) or declines (invitation dropped).
    Either path deletes the invitation row, which cascades to clean up the
    matching notification inbox entry."""
    inv = (
        db.query(CommunityInvitation)
        .filter(
            CommunityInvitation.id == invitation_id,
            CommunityInvitation.user_id == user_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found.")

    community_id = inv.community_id

    if accept:
        c = db.query(Community).filter(Community.id == community_id).first()
        if not c:
            # Community was deleted between invite and accept.
            db.delete(inv)
            db.commit()
            raise HTTPException(status_code=404, detail="Group no longer exists.")
        # In the unlikely case a parallel join already created the member row,
        # don't double-insert; just clear the invite.
        if _viewer_role(db, community_id, user_id) is None:
            db.add(
                CommunityMember(
                    community_id=community_id, user_id=user_id, role="member"
                )
            )
            c.member_count = (c.member_count or 0) + 1

    db.delete(inv)
    db.commit()
    return {"community_id": community_id, "accepted": accept}


def list_my_invitations(db: Session, user_id: str) -> list[dict]:
    """Pending invitations for the current user, newest first. Includes
    community + inviter info so the inbox UI can render without extra calls."""
    rows = (
        db.query(CommunityInvitation, Community, User)
        .join(Community, Community.id == CommunityInvitation.community_id)
        .outerjoin(User, User.id == CommunityInvitation.invited_by)
        .filter(CommunityInvitation.user_id == user_id)
        .order_by(CommunityInvitation.created_at.desc())
        .all()
    )
    return [
        {
            "id": inv.id,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
            "community": {
                "id": c.id,
                "slug": c.slug,
                "name": c.name,
                "description": c.description,
                "banner_color": c.banner_color,
                "visibility": c.visibility,
                "member_count": c.member_count or 0,
            },
            "invited_by": (
                {
                    "id": inviter.id,
                    "username": inviter.username,
                    "display_name": inviter.display_name,
                }
                if inviter
                else None
            ),
        }
        for inv, c, inviter in rows
    ]


def list_group_invitations(db: Session, viewer_id: str, community_id: int) -> list[dict]:
    """Pending invitations for a group — visible to owner/admin only.
    Lets admins see who's been invited but hasn't responded yet."""
    _require_role(db, community_id, viewer_id, ("owner", "admin"))
    rows = (
        db.query(CommunityInvitation, User)
        .join(User, User.id == CommunityInvitation.user_id)
        .filter(CommunityInvitation.community_id == community_id)
        .order_by(CommunityInvitation.created_at.desc())
        .all()
    )
    return [
        {
            "id": inv.id,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
            "user": {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
            },
        }
        for inv, u in rows
    ]


def revoke_invitation(
    db: Session, actor_id: str, community_id: int, invitation_id: int
) -> None:
    """Owner/admin cancels a pending invitation before it's responded to."""
    _require_role(db, community_id, actor_id, ("owner", "admin"))
    inv = (
        db.query(CommunityInvitation)
        .filter(
            CommunityInvitation.id == invitation_id,
            CommunityInvitation.community_id == community_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    db.delete(inv)
    db.commit()


def remove_member(
    db: Session, actor_id: str, community_id: int, target_user_id: str
) -> None:
    c, actor_role = _require_role(db, community_id, actor_id, ("owner", "admin"))
    target_role = _viewer_role(db, community_id, target_user_id)
    if target_role is None:
        raise HTTPException(status_code=404, detail="That user is not a member.")
    if target_role == "owner":
        raise HTTPException(status_code=403, detail="You can't remove an owner.")
    if target_role == "admin" and actor_role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can remove admins.")

    db.query(CommunityMember).filter(
        CommunityMember.community_id == community_id,
        CommunityMember.user_id == target_user_id,
    ).delete()
    c.member_count = max(0, (c.member_count or 1) - 1)
    db.commit()


def set_member_role(
    db: Session, actor_id: str, community_id: int, target_user_id: str, role: str
) -> None:
    if role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail="Role must be admin or member.")
    _require_role(db, community_id, actor_id, ("owner",))
    m = (
        db.query(CommunityMember)
        .filter(
            CommunityMember.community_id == community_id,
            CommunityMember.user_id == target_user_id,
        )
        .first()
    )
    if not m:
        raise HTTPException(status_code=404, detail="That user is not a member.")
    if m.role == "owner":
        raise HTTPException(status_code=400, detail="Owner role cannot be changed here.")
    m.role = role
    db.commit()


# ─── Media (attached titles) ───────────────────────────────────────────────

def _require_member(db: Session, community_id: int, user_id: str) -> Community:
    c = db.query(Community).filter(Community.id == community_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    if _viewer_role(db, community_id, user_id) is None:
        # Members-only action
        raise HTTPException(status_code=403, detail="Join the group to do that.")
    return c


def add_media(
    db: Session, user_id: str, community_id: int, content_type: str, content_id: int
) -> dict:
    if content_type not in ("movie", "tv"):
        raise HTTPException(status_code=422, detail="content_type must be movie or tv.")
    c = _require_member(db, community_id, user_id)
    role = _viewer_role(db, community_id, user_id)
    if role not in ("owner", "admin") and not c.members_can_edit_media:
        raise HTTPException(
            status_code=403,
            detail="Only owners and admins can add titles to this group.",
        )

    # Ensure the underlying Movie/Show row exists locally so list_media can
    # join against it. Without this step, the CommunityMedia row gets created
    # but the read endpoint silently drops it (the join finds nothing) — which
    # is exactly the "add succeeds, title doesn't show up" bug iOS was hitting.
    #
    # Short-circuit when a row with display data already exists: that's the
    # common case (someone else already tracks the title) and saves a TMDb call.
    if content_type == "movie":
        existing_movie = db.query(Movie).filter_by(id=content_id).first()
        if not (existing_movie and existing_movie.title):
            if populate_movie_full(db, content_id) is None:
                raise HTTPException(
                    status_code=404,
                    detail="Could not find that movie on TMDb.",
                )
    else:
        existing_show = db.query(Show).filter_by(id=content_id).first()
        if not (existing_show and existing_show.name):
            try:
                ensure_show_in_db(db, content_id, already_tracked=True)
            except ValueError:
                raise HTTPException(
                    status_code=404,
                    detail="Could not find that show on TMDb.",
                )

    existing = (
        db.query(CommunityMedia)
        .filter(
            CommunityMedia.community_id == community_id,
            CommunityMedia.content_type == content_type,
            CommunityMedia.content_id == content_id,
        )
        .first()
    )
    if existing:
        return {"id": existing.id}
    m = CommunityMedia(
        community_id=community_id,
        content_type=content_type,
        content_id=content_id,
        added_by=user_id,
    )
    db.add(m)
    try:
        db.commit()
    except IntegrityError:
        # Race: another request added the same title between our check and
        # commit. Return the existing row so the client still gets a 200.
        db.rollback()
        existing = (
            db.query(CommunityMedia)
            .filter(
                CommunityMedia.community_id == community_id,
                CommunityMedia.content_type == content_type,
                CommunityMedia.content_id == content_id,
            )
            .first()
        )
        if existing:
            return {"id": existing.id}
        raise
    db.refresh(m)
    return {"id": m.id}


def remove_media(db: Session, user_id: str, community_id: int, media_id: int) -> None:
    m = (
        db.query(CommunityMedia)
        .filter(CommunityMedia.id == media_id, CommunityMedia.community_id == community_id)
        .first()
    )
    if not m:
        raise HTTPException(status_code=404, detail="Title not found in this group.")
    c = db.query(Community).filter(Community.id == community_id).first()
    role = _viewer_role(db, community_id, user_id)
    is_staff = role in ("owner", "admin")
    # Owners/admins can always remove. Otherwise:
    #   - When members_can_edit_media is on, any member can remove any title.
    #   - When off, members can only remove titles they themselves added.
    if not is_staff:
        if c and c.members_can_edit_media:
            if role is None:
                raise HTTPException(status_code=403, detail="Join the group to do that.")
        elif m.added_by != user_id:
            raise HTTPException(
                status_code=403,
                detail="Only owners and admins can remove titles in this group.",
            )
    db.delete(m)
    db.commit()


def list_media(db: Session, community_id: int, viewer_id: str) -> dict:
    c = db.query(Community).filter(Community.id == community_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    if c.visibility == "private" and _viewer_role(db, community_id, viewer_id) is None:
        raise HTTPException(status_code=404, detail="Group not found.")
    rows = (
        db.query(CommunityMedia)
        .filter(CommunityMedia.community_id == community_id)
        .order_by(desc(CommunityMedia.added_at))
        .all()
    )
    movie_ids = [r.content_id for r in rows if r.content_type == "movie"]
    show_ids = [r.content_id for r in rows if r.content_type == "tv"]
    movies = (
        {m.id: m for m in db.query(Movie).filter(Movie.id.in_(movie_ids)).all()}
        if movie_ids
        else {}
    )
    shows = (
        {s.id: s for s in db.query(Show).filter(Show.id.in_(show_ids)).all()}
        if show_ids
        else {}
    )
    out_movies, out_shows = [], []
    for r in rows:
        if r.content_type == "movie":
            m = movies.get(r.content_id)
            if not m:
                continue
            out_movies.append(
                {
                    "id": r.id,
                    "content_id": m.id,
                    "title": m.title,
                    "poster_path": m.poster_path,
                    "added_by": r.added_by,
                    "added_at": r.added_at,
                }
            )
        else:
            s = shows.get(r.content_id)
            if not s:
                continue
            out_shows.append(
                {
                    "id": r.id,
                    "content_id": s.id,
                    "name": s.name,
                    "poster_path": s.poster_path,
                    "added_by": r.added_by,
                    "added_at": r.added_at,
                }
            )
    return {"movies": out_movies, "shows": out_shows}


# ─── Discussion board ──────────────────────────────────────────────────────

def create_post(
    db: Session,
    user_id: str,
    community_id: int,
    title: str | None,
    body: str,
) -> dict:
    _require_member(db, community_id, user_id)
    body = (body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Post body cannot be empty.")
    if len(body) > MAX_POST_LEN:
        raise HTTPException(status_code=422, detail=f"Post too long (max {MAX_POST_LEN}).")
    if title is not None:
        title = title.strip() or None
        if title and len(title) > 150:
            raise HTTPException(status_code=422, detail="Title too long.")
    p = CommunityPost(
        community_id=community_id, user_id=user_id, title=title, body=body
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _serialize_post(p, db.get(User, user_id))


def list_posts(
    db: Session, community_id: int, viewer_id: str, limit: int = 30, offset: int = 0
) -> list[dict]:
    c = db.query(Community).filter(Community.id == community_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Group not found.")
    if c.visibility == "private" and _viewer_role(db, community_id, viewer_id) is None:
        raise HTTPException(status_code=404, detail="Group not found.")
    rows = (
        db.query(CommunityPost, User)
        .join(User, User.id == CommunityPost.user_id)
        .filter(CommunityPost.community_id == community_id)
        .order_by(desc(CommunityPost.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )
    post_ids = [p.id for p, _ in rows]
    liked_ids = _liked_post_ids(db, viewer_id, post_ids)
    return [_serialize_post(p, u, viewer_liked=(p.id in liked_ids)) for p, u in rows]


def _liked_post_ids(db: Session, viewer_id: str, post_ids: list[int]) -> set[int]:
    if not post_ids or not viewer_id:
        return set()
    rows = (
        db.query(CommunityPostLike.post_id)
        .filter(
            CommunityPostLike.user_id == viewer_id,
            CommunityPostLike.post_id.in_(post_ids),
        )
        .all()
    )
    return {r.post_id for r in rows}


def _liked_reply_ids(db: Session, viewer_id: str, reply_ids: list[int]) -> set[int]:
    if not reply_ids or not viewer_id:
        return set()
    rows = (
        db.query(CommunityReplyLike.reply_id)
        .filter(
            CommunityReplyLike.user_id == viewer_id,
            CommunityReplyLike.reply_id.in_(reply_ids),
        )
        .all()
    )
    return {r.reply_id for r in rows}


def _serialize_post(p: CommunityPost, u: User | None, viewer_liked: bool = False) -> dict:
    return {
        "id": p.id,
        "community_id": p.community_id,
        "title": p.title,
        "body": p.body,
        "reply_count": p.reply_count,
        "like_count": p.like_count or 0,
        "viewer_liked": viewer_liked,
        "edited_at": p.edited_at,
        "created_at": p.created_at,
        "user": _serialize_user(u),
    }


def _serialize_reply(r: CommunityReply, u: User | None, viewer_liked: bool = False) -> dict:
    return {
        "id": r.id,
        "post_id": r.post_id,
        "body": r.body,
        "like_count": r.like_count or 0,
        "viewer_liked": viewer_liked,
        "edited_at": r.edited_at,
        "created_at": r.created_at,
        "user": _serialize_user(u),
    }


def get_post_with_replies(db: Session, post_id: int, viewer_id: str) -> dict:
    p = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found.")
    c = db.query(Community).filter(Community.id == p.community_id).first()
    if c and c.visibility == "private" and _viewer_role(db, c.id, viewer_id) is None:
        raise HTTPException(status_code=404, detail="Post not found.")
    author = db.get(User, p.user_id)
    reply_rows = (
        db.query(CommunityReply, User)
        .join(User, User.id == CommunityReply.user_id)
        .filter(CommunityReply.post_id == post_id)
        .order_by(CommunityReply.created_at.asc())
        .all()
    )
    reply_ids = [r.id for r, _ in reply_rows]
    liked_replies = _liked_reply_ids(db, viewer_id, reply_ids)
    post_liked = post_id in _liked_post_ids(db, viewer_id, [post_id])
    return {
        "post": _serialize_post(p, author, viewer_liked=post_liked),
        "replies": [
            _serialize_reply(r, u, viewer_liked=(r.id in liked_replies))
            for r, u in reply_rows
        ],
    }


def add_reply(db: Session, user_id: str, post_id: int, body: str) -> dict:
    p = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found.")
    _require_member(db, p.community_id, user_id)
    body = (body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Reply cannot be empty.")
    if len(body) > MAX_REPLY_LEN:
        raise HTTPException(status_code=422, detail=f"Reply too long (max {MAX_REPLY_LEN}).")
    r = CommunityReply(post_id=post_id, user_id=user_id, body=body)
    db.add(r)
    p.reply_count = (p.reply_count or 0) + 1
    db.commit()
    db.refresh(r)
    return _serialize_reply(r, db.get(User, user_id))


def delete_post(db: Session, user_id: str, post_id: int) -> None:
    p = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found.")
    role = _viewer_role(db, p.community_id, user_id)
    if p.user_id != user_id and role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="You can only delete your own posts.")
    db.delete(p)
    db.commit()


def update_post(
    db: Session, user_id: str, post_id: int, title: str | None, body: str
) -> dict:
    p = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found.")
    if p.user_id != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own posts.")
    body = (body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Post body cannot be empty.")
    if len(body) > MAX_POST_LEN:
        raise HTTPException(status_code=422, detail=f"Post too long (max {MAX_POST_LEN}).")
    if title is not None:
        title = title.strip() or None
        if title and len(title) > 150:
            raise HTTPException(status_code=422, detail="Title too long.")
    p.title = title
    p.body = body
    p.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)
    liked = post_id in _liked_post_ids(db, user_id, [post_id])
    return _serialize_post(p, db.get(User, p.user_id), viewer_liked=liked)


def update_reply(db: Session, user_id: str, reply_id: int, body: str) -> dict:
    r = db.query(CommunityReply).filter(CommunityReply.id == reply_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reply not found.")
    if r.user_id != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own replies.")
    body = (body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Reply cannot be empty.")
    if len(body) > MAX_REPLY_LEN:
        raise HTTPException(status_code=422, detail=f"Reply too long (max {MAX_REPLY_LEN}).")
    r.body = body
    r.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(r)
    liked = reply_id in _liked_reply_ids(db, user_id, [reply_id])
    return _serialize_reply(r, db.get(User, r.user_id), viewer_liked=liked)


def toggle_post_like(db: Session, user_id: str, post_id: int) -> dict:
    p = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found.")
    # Must be allowed to view the post (private-group check)
    c = db.query(Community).filter(Community.id == p.community_id).first()
    if c and c.visibility == "private" and _viewer_role(db, c.id, user_id) is None:
        raise HTTPException(status_code=404, detail="Post not found.")

    existing = (
        db.query(CommunityPostLike)
        .filter(
            CommunityPostLike.post_id == post_id, CommunityPostLike.user_id == user_id
        )
        .first()
    )
    if existing:
        db.delete(existing)
        p.like_count = max(0, (p.like_count or 1) - 1)
        liked = False
    else:
        try:
            db.add(CommunityPostLike(post_id=post_id, user_id=user_id))
            p.like_count = (p.like_count or 0) + 1
            liked = True
        except IntegrityError:
            db.rollback()
            liked = True
    db.commit()
    return {"liked": liked, "like_count": p.like_count}


def toggle_reply_like(db: Session, user_id: str, reply_id: int) -> dict:
    r = db.query(CommunityReply).filter(CommunityReply.id == reply_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reply not found.")
    p = db.query(CommunityPost).filter(CommunityPost.id == r.post_id).first()
    if p:
        c = db.query(Community).filter(Community.id == p.community_id).first()
        if c and c.visibility == "private" and _viewer_role(db, c.id, user_id) is None:
            raise HTTPException(status_code=404, detail="Reply not found.")

    existing = (
        db.query(CommunityReplyLike)
        .filter(
            CommunityReplyLike.reply_id == reply_id,
            CommunityReplyLike.user_id == user_id,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        r.like_count = max(0, (r.like_count or 1) - 1)
        liked = False
    else:
        try:
            db.add(CommunityReplyLike(reply_id=reply_id, user_id=user_id))
            r.like_count = (r.like_count or 0) + 1
            liked = True
        except IntegrityError:
            db.rollback()
            liked = True
    db.commit()
    return {"liked": liked, "like_count": r.like_count}


def delete_reply(db: Session, user_id: str, reply_id: int) -> None:
    r = db.query(CommunityReply).filter(CommunityReply.id == reply_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reply not found.")
    p = db.query(CommunityPost).filter(CommunityPost.id == r.post_id).first()
    role = _viewer_role(db, p.community_id, user_id) if p else None
    if r.user_id != user_id and role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="You can only delete your own replies.")
    db.delete(r)
    if p:
        p.reply_count = max(0, (p.reply_count or 1) - 1)
    db.commit()

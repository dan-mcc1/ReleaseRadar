from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.community import Community
from app.models.user import User
from app.services import community_service as svc
from app.services.email_service import send_community_invite_email
from app.services.push_service import push_notification
from app.schemas.common import (
    COMMUNITY_DESC_MAX_LEN,
    COMMUNITY_NAME_MAX_LEN,
    COMMUNITY_NAME_MIN_LEN,
    COMMUNITY_POST_BODY_MAX_LEN,
    COMMUNITY_POST_TITLE_MAX_LEN,
    COMMUNITY_REPLY_BODY_MAX_LEN,
    USERNAME_MAX_LEN,
    USERNAME_MIN_LEN,
    USERNAME_PATTERN,
    HEX_COLOR_PATTERN,
    CommunityRole,
    ContentType,
    Visibility,
)

router = APIRouter()


class CreateCommunityBody(BaseModel):
    name: str = Field(..., min_length=COMMUNITY_NAME_MIN_LEN, max_length=COMMUNITY_NAME_MAX_LEN)
    description: str | None = Field(None, max_length=COMMUNITY_DESC_MAX_LEN)
    visibility: Visibility = "public"
    banner_color: str | None = Field(None, pattern=HEX_COLOR_PATTERN)


class UpdateCommunityBody(BaseModel):
    name: str | None = Field(None, min_length=COMMUNITY_NAME_MIN_LEN, max_length=COMMUNITY_NAME_MAX_LEN)
    description: str | None = Field(None, max_length=COMMUNITY_DESC_MAX_LEN)
    visibility: Visibility | None = None
    banner_color: str | None = Field(None, pattern=HEX_COLOR_PATTERN)
    members_can_edit_media: bool | None = None


class AddMediaBody(BaseModel):
    content_type: ContentType
    content_id: int = Field(..., ge=1)


class CreatePostBody(BaseModel):
    title: str | None = Field(None, max_length=COMMUNITY_POST_TITLE_MAX_LEN)
    body: str = Field(..., min_length=1, max_length=COMMUNITY_POST_BODY_MAX_LEN)


class ReplyBody(BaseModel):
    body: str = Field(..., min_length=1, max_length=COMMUNITY_REPLY_BODY_MAX_LEN)


class InviteMemberBody(BaseModel):
    username: str = Field(
        ..., min_length=USERNAME_MIN_LEN, max_length=USERNAME_MAX_LEN, pattern=USERNAME_PATTERN
    )


class SetRoleBody(BaseModel):
    role: CommunityRole


class InvitationRespondBody(BaseModel):
    accept: bool


class BrowseQuery(BaseModel):
    q: str | None = Field(None, max_length=100)
    limit: int = Field(30, ge=1, le=100)
    offset: int = Field(0, ge=0)


# ─── Discovery / CRUD ──────────────────────────────────────────────────────

@router.get("")
def browse(
    request: Request,
    q: str | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.list_communities(db, uid, q=q, limit=limit, offset=offset)


@router.get("/mine")
def mine(db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    return svc.list_my_communities(db, uid)


@router.post("")
@limiter.limit("10/hour")
def create(
    request: Request,
    body: CreateCommunityBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    c = svc.create_community(
        db,
        uid,
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        banner_color=body.banner_color,
    )
    return svc._serialize_community(c, viewer_role="owner")


@router.get("/{slug}")
def get_one(
    slug: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.get_community_by_slug(db, slug, viewer_id=uid)


@router.patch("/{community_id}")
def update(
    community_id: int,
    body: UpdateCommunityBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    c = svc.update_community(
        db,
        uid,
        community_id,
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        banner_color=body.banner_color,
        members_can_edit_media=body.members_can_edit_media,
    )
    role = svc._viewer_role(db, c.id, uid)
    return svc._serialize_community(c, viewer_role=role)


@router.delete("/{community_id}")
def delete(
    community_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.delete_community(db, uid, community_id)
    return {"deleted": True}


# ─── Membership ────────────────────────────────────────────────────────────

@router.post("/{community_id}/join")
def join(
    community_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.join_community(db, uid, community_id)


@router.post("/{community_id}/leave")
def leave(
    community_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.leave_community(db, uid, community_id)
    return {"left": True}


@router.get("/{community_id}/members")
def members(
    community_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.list_members(db, community_id, viewer_id=uid)


@router.post("/{community_id}/members/invite")
def invite(
    community_id: int,
    body: InviteMemberBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    inv = svc.invite_member(db, uid, community_id, body.username)

    # Email + push the invitee. Failures don't roll back the invitation.
    community = db.query(Community).filter(Community.id == inv.community_id).first()
    invitee = db.query(User).filter(User.id == inv.user_id).first()
    inviter = db.query(User).filter(User.id == uid).first()
    inviter_name = (inviter.username if inviter else None) or "Someone"

    if community and invitee:
        if invitee.email and invitee.email_notifications:
            background_tasks.add_task(
                send_community_invite_email,
                to_email=invitee.email,
                to_username=invitee.username or "",
                from_username=inviter_name,
                group_name=community.name,
                group_slug=community.slug,
                uid=invitee.id,
            )
        try:
            push_notification(
                db,
                invitee.id,
                type="community_invite",
                title=f"Invitation to {community.name}",
                body=f"{inviter_name} invited you to join {community.name}",
                community_invitation_id=inv.id,
            )
        except Exception:
            pass

    return {
        "id": inv.id,
        "community_id": inv.community_id,
        "user_id": inv.user_id,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


# ─── Invitations (invitee side) ────────────────────────────────────────────

@router.get("/invitations/mine")
def my_invitations(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Pending invitations for the current user."""
    return svc.list_my_invitations(db, uid)


@router.post("/invitations/{invitation_id}/respond")
def respond_to_invitation(
    invitation_id: int,
    body: InvitationRespondBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.respond_to_invitation(db, uid, invitation_id, body.accept)


@router.get("/{community_id}/invitations")
def group_invitations(
    community_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Pending invitations issued by/for a group — admin-only."""
    return svc.list_group_invitations(db, uid, community_id)


@router.delete("/{community_id}/invitations/{invitation_id}")
def revoke_invitation(
    community_id: int,
    invitation_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.revoke_invitation(db, uid, community_id, invitation_id)
    return {"revoked": True}


@router.delete("/{community_id}/members/{user_id}")
def remove(
    community_id: int,
    user_id: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.remove_member(db, uid, community_id, user_id)
    return {"removed": True}


@router.patch("/{community_id}/members/{user_id}/role")
def set_role(
    community_id: int,
    user_id: str,
    body: SetRoleBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.set_member_role(db, uid, community_id, user_id, body.role)
    return {"role": body.role}


# ─── Media ─────────────────────────────────────────────────────────────────

@router.get("/{community_id}/media")
def media(
    community_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.list_media(db, community_id, viewer_id=uid)


@router.post("/{community_id}/media")
def add_media(
    community_id: int,
    body: AddMediaBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.add_media(db, uid, community_id, body.content_type, body.content_id)


@router.delete("/{community_id}/media/{media_id}")
def remove_media(
    community_id: int,
    media_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.remove_media(db, uid, community_id, media_id)
    return {"removed": True}


# ─── Posts / replies ───────────────────────────────────────────────────────

@router.get("/{community_id}/posts")
def list_posts(
    community_id: int,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.list_posts(db, community_id, viewer_id=uid, limit=limit, offset=offset)


@router.post("/{community_id}/posts")
@limiter.limit("30/hour")
def create_post(
    request: Request,
    community_id: int,
    body: CreatePostBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.create_post(db, uid, community_id, title=body.title, body=body.body)


@router.get("/posts/{post_id}")
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.get_post_with_replies(db, post_id, viewer_id=uid)


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.delete_post(db, uid, post_id)
    return {"deleted": True}


@router.post("/posts/{post_id}/replies")
@limiter.limit("60/hour")
def add_reply(
    request: Request,
    post_id: int,
    body: ReplyBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.add_reply(db, uid, post_id, body.body)


@router.patch("/posts/{post_id}")
def update_post(
    post_id: int,
    body: CreatePostBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.update_post(db, uid, post_id, title=body.title, body=body.body)


@router.patch("/replies/{reply_id}")
def update_reply(
    reply_id: int,
    body: ReplyBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.update_reply(db, uid, reply_id, body.body)


@router.post("/posts/{post_id}/like")
def toggle_post_like(
    post_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.toggle_post_like(db, uid, post_id)


@router.post("/replies/{reply_id}/like")
def toggle_reply_like(
    reply_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return svc.toggle_reply_like(db, uid, reply_id)


@router.delete("/replies/{reply_id}")
def delete_reply(
    reply_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    svc.delete_reply(db, uid, reply_id)
    return {"deleted": True}

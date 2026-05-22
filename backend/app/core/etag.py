import hashlib

import orjson
from fastapi import Request, Response
from fastapi.encoders import jsonable_encoder

_CC = "private, max-age=30, stale-while-revalidate=120"


def etag_response(request: Request, response: Response, payload) -> Response | None:
    """
    Compute a strong ETag for payload and short-circuit with 304 if the client
    already has the current version. Otherwise stamp ETag + Cache-Control onto
    the outgoing response and return None so the caller returns the payload
    normally.

    Usage:
        if hit := etag_response(request, response, payload):
            return hit
        return payload
    """
    # jsonable_encoder normalises any SQLAlchemy / Pydantic / date objects to
    # plain Python types so orjson can always serialise them.
    raw = orjson.dumps(jsonable_encoder(payload), option=orjson.OPT_SORT_KEYS)
    tag = f'"{hashlib.md5(raw).hexdigest()}"'
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304)
    response.headers["ETag"] = tag
    response.headers["Cache-Control"] = _CC
    return None

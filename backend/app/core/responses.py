"""JSON responses serialized with orjson."""
from typing import Any

import orjson
from starlette.responses import Response


class FastJSONResponse(Response):
    """
    Return this from a route with a large payload. FastAPI runs every plain
    return value through jsonable_encoder, a pure-Python walk of each value:
    about 15 ms for a 330 KB calendar. A Response skips that, and orjson
    serializes the same payload in well under a millisecond. The content must
    already be JSON-ready (str keys; str, int, float, bool, None, list, dict;
    date and datetime are fine too).
    """

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content)

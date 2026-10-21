"""
The Server-Timing header and the per-request SQL stats behind it.

Sync routes run in a threadpool with a copy of the request's context; these
check the statements they run still reach the middleware.
"""
import logging
import re

from app.core.logging import TimedAccessFormatter, request_elapsed_ms, request_stats, RequestStats

TIMING = re.compile(r'^total;dur=([\d.]+), db;dur=([\d.]+);desc="(\d+) queries"$')


def _timing(response):
    match = TIMING.match(response.headers["server-timing"])
    assert match, response.headers["server-timing"]
    total, db, queries = match.groups()
    return float(total), float(db), int(queries)


def test_counts_a_sync_routes_queries(client, seed_users, seed_show):
    client.post("/watchlist/add", json={"content_type": "tv", "content_id": 1396})

    r = client.get("/calendar?from_date=2008-01-01&to_date=2008-01-31")

    assert r.status_code == 200
    total, db, queries = _timing(r)
    # The tracked-list union, then shows, episodes; no movies tracked.
    assert queries == 3
    assert 0 < db <= total


def test_request_without_sql_reports_zero(client):
    total, db, queries = _timing(client.get("/no-such-route"))
    assert (db, queries) == (0.0, 0)
    assert total >= 0


def test_timing_allow_origin_lists_the_frontend(client):
    r = client.get("/no-such-route")
    assert "http://localhost:5173" in r.headers["timing-allow-origin"]


def test_access_log_shows_the_request_stats():
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d', ("1.2.3.4", "GET", "/calendar", "1.1", 200), None,
    )
    request_elapsed_ms.set(12.4)
    request_stats.set(RequestStats(queries=3, db_ms=4.0))
    try:
        line = TimedAccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s').format(record)
    finally:
        request_elapsed_ms.set(None)
        request_stats.set(None)
    assert line.endswith("(12ms, 3q)")

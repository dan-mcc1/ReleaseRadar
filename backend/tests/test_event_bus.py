"""publish() is called from sync route handlers, which FastAPI runs in worker
threads, while subscribers wait on the event loop thread. asyncio.Queue isn't
thread-safe: a put from another thread didn't wake the waiting stream, so
badge updates could sit until the 25 s keepalive."""

import asyncio
import threading

from app.core import event_bus


def _run(coro):
    """Like asyncio.run, but leaves the thread's current-loop setting alone
    (asyncio.run clears it, which breaks later tests using get_event_loop)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_publish_from_a_worker_thread_reaches_the_waiting_stream():
    errors = []
    received = []

    async def scenario():
        q = event_bus.subscribe("u-thread")
        try:
            getter = asyncio.ensure_future(q.get())
            await asyncio.sleep(0)  # the stream is now waiting

            def publish():
                try:
                    event_bus.publish("u-thread", {"type": "counts_update"})
                except Exception as e:  # surfaced below
                    errors.append(e)

            threading.Thread(target=publish).start()
            received.append(await getter)
        finally:
            event_bus.unsubscribe("u-thread", q)

    # The loop runs in its own thread: with the bug the waiting task is never
    # woken (and can't even be cancelled), so a join timeout is the only way
    # to turn that hang into a failure. debug=True makes asyncio reject loop
    # calls made from the wrong thread.
    loop_thread = threading.Thread(
        target=lambda: asyncio.run(scenario(), debug=True), daemon=True
    )
    loop_thread.start()
    loop_thread.join(timeout=3)

    assert errors == []
    assert received == [{"type": "counts_update"}]


def test_full_queue_drops_instead_of_raising():
    async def scenario():
        q = event_bus.subscribe("u-full")
        try:
            for i in range(40):  # queue holds 32
                event_bus.publish("u-full", {"n": i})
            await asyncio.sleep(0.05)
            return q.qsize()
        finally:
            event_bus.unsubscribe("u-full", q)

    assert _run(scenario()) == 32


def test_unsubscribed_stream_gets_nothing():
    async def scenario():
        q = event_bus.subscribe("u-gone")
        event_bus.unsubscribe("u-gone", q)
        event_bus.publish("u-gone", {"type": "x"})
        await asyncio.sleep(0.05)
        return q.qsize()

    assert _run(scenario()) == 0

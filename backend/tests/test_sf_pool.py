import pytest

from sf_pool import SnowflakePool


class FakeConn:
    made = 0

    def __init__(self):
        FakeConn.made += 1
        self.id = FakeConn.made
        self.closed = False

    def is_closed(self):
        return self.closed

    def close(self):
        self.closed = True


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


def make(clock, **kw):
    return SnowflakePool(FakeConn, clock=clock, **kw)


def test_reuses_connection(clock):
    pool = make(clock)
    with pool.connection() as a:
        pass
    with pool.connection() as b:
        pass
    assert a is b and not a.closed


def test_concurrent_use_gets_separate_connections(clock):
    pool = make(clock)
    with pool.connection() as a, pool.connection() as b:
        assert a is not b


def test_idle_too_long_is_replaced(clock):
    pool = make(clock, max_idle=60)
    with pool.connection() as a:
        pass
    clock.t += 61
    with pool.connection() as b:
        pass
    assert a is not b and a.closed


def test_too_old_is_replaced(clock):
    pool = make(clock, max_idle=1000, max_age=100)
    with pool.connection() as a:
        pass
    for _ in range(3):
        clock.t += 40
        with pool.connection() as c:
            pass
    assert c is not a and a.closed


def test_closed_by_server_is_replaced(clock):
    pool = make(clock)
    with pool.connection() as a:
        pass
    a.closed = True
    with pool.connection() as b:
        pass
    assert a is not b


def test_driver_error_discards_connection(clock):
    from snowflake.connector.errors import OperationalError
    pool = make(clock)
    with pytest.raises(OperationalError):
        with pool.connection() as a:
            raise OperationalError("network")
    assert a.closed
    with pool.connection() as b:
        pass
    assert b is not a


def test_normal_exception_keeps_connection(clock):
    pool = make(clock)
    with pytest.raises(ValueError):
        with pool.connection() as a:
            raise ValueError("404 path")
    with pool.connection() as b:
        pass
    assert a is b


def test_idle_cap(clock):
    pool = make(clock, max_idle_conns=1)
    with pool.connection() as a, pool.connection() as b:
        pass
    assert sum(c.closed for c in (a, b)) == 1


def test_close_all(clock):
    pool = make(clock)
    with pool.connection() as a:
        pass
    pool.close_all()
    assert a.closed
    with pool.connection() as b:
        pass
    assert b.closed  # not kept after shutdown


def test_discard_closes_on_release(clock):
    pool = make(clock)
    with pool.connection() as a:
        pool.discard(a)
    assert a.closed
    with pool.connection() as b:
        pass
    assert b is not a


# ── Postgres pool (postgres_query_runner.PgConnectionPool), against a real server ──
import os as _os
import threading as _threading
import time as _time

_PG_DSN = _os.environ.get("DATA_API_TEST_PG_DSN")
_pg = pytest.mark.skipif(not _PG_DSN, reason="DATA_API_TEST_PG_DSN not set")


def _pg_pool(**kw):
    import psycopg2
    from postgres_query_runner import PgConnectionPool
    return PgConnectionPool(lambda: psycopg2.connect(_PG_DSN), "test", **kw)


@_pg
def test_pg_pool_runs_queries_side_by_side():
    pool = _pg_pool()
    pool.run("select 1")
    t0 = _time.time()
    ths = [_threading.Thread(target=pool.run, args=("select pg_sleep(0.4)",)) for _ in range(6)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    assert _time.time() - t0 < 1.2  # one shared connection took ~2.4s
    pool.close_all()


@_pg
def test_pg_pool_recovers_when_server_kills_connections():
    import psycopg2
    pool = _pg_pool()
    for _ in range(3):
        pool.run("select 1")
    pids = [r[0] for r in pool.run("select pg_backend_pid()")[1]]
    admin = psycopg2.connect(_PG_DSN)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute("select pg_terminate_backend(%s)", (pids[0],))
    admin.close()
    _time.sleep(0.2)
    assert pool.run("select 42")[1] == [(42,)]
    pool.close_all()


@_pg
def test_pg_pool_caps_open_connections():
    pool = _pg_pool(max_open=3, max_idle=2)
    seen = []
    def q():
        seen.append(pool.run("select count(*) from pg_stat_activity where application_name = '' and backend_type = 'client backend'")[1][0][0])
        pool.run("select pg_sleep(0.2)")
    ths = [_threading.Thread(target=q) for _ in range(10)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    assert len(pool._idle) <= 2
    pool.close_all()


@_pg
def test_pg_pool_sql_error_keeps_connection_usable():
    import psycopg2
    pool = _pg_pool()
    with pytest.raises(psycopg2.Error):
        pool.run("select * from no_such_table")
    assert pool.run("select 1")[1] == [(1,)]
    pool.close_all()


# ── Explorer result cache (unstructured._cache_*): bounded by age, count and bytes ──

@pytest.fixture
def ucache(monkeypatch):
    import unstructured as U
    U._cache.clear()
    monkeypatch.setattr(U, "_cache_bytes", 0)
    monkeypatch.setattr(U, "_cache_swept", 0.0)
    yield U
    U._cache.clear()
    U._cache_bytes = 0


def test_cache_roundtrip_and_expiry(ucache, monkeypatch):
    U = ucache
    U._cache_set("k", {"rows": [1, 2, 3]})
    assert U._cache_get("k") == {"rows": [1, 2, 3]}
    real = U.time.time
    monkeypatch.setattr(U.time, "time", lambda: real() + U.CACHE_TTL_SECONDS + 1)
    assert U._cache_get("k") is None
    assert "k" not in U._cache and U._cache_bytes == 0  # expired entry is freed, not kept


def test_cache_stays_under_byte_budget(ucache, monkeypatch):
    U = ucache
    monkeypatch.setattr(U, "CACHE_MAX_BYTES", 200_000)
    blob = "x" * 30_000
    for i in range(50):
        U._cache_set(f"k{i}", {"text": blob})
    assert U._cache_bytes <= 200_000
    assert U._cache_get("k49") is not None   # newest kept
    assert U._cache_get("k0") is None        # oldest evicted
    assert U._cache_bytes == sum(e[2] for e in U._cache.values())


def test_cache_skips_oversized_payload(ucache, monkeypatch):
    U = ucache
    monkeypatch.setattr(U, "CACHE_MAX_BYTES", 100_000)
    U._cache_set("small", {"a": 1})
    U._cache_set("huge", {"text": "x" * 60_000})  # over a quarter of the budget
    assert U._cache_get("huge") is None and U._cache_get("small") == {"a": 1}


def test_cache_sweeps_expired_entries(ucache, monkeypatch):
    U = ucache
    for i in range(20):
        U._cache_set(f"old{i}", {"i": i})
    real = U.time.time
    monkeypatch.setattr(U.time, "time", lambda: real() + U.CACHE_TTL_SECONDS + U.CACHE_SWEEP_SECONDS + 1)
    U._cache_set("fresh", {"i": -1})
    assert list(U._cache) == ["fresh"]


def test_cache_overwrite_keeps_byte_count_right(ucache):
    U = ucache
    U._cache_set("k", {"text": "x" * 1000})
    U._cache_set("k", {"text": "x" * 10})
    assert U._cache_bytes == U._cache["k"][2]


def test_rim_source_is_configurable_and_validated():
    import unstructured as U
    try:
        U.set_unstructured_dependencies({"rimdocs_table": "DB.SCH.RIM_NARROW"})
        assert "FROM DB.SCH.RIM_NARROW" in U.BASE_CTE
        U.set_unstructured_dependencies({"rimdocs_table": "T; DROP TABLE X"})
        assert U.DEFAULT_SOURCE_OBJECT in U.BASE_CTE
    finally:
        U.set_unstructured_dependencies(None)
    assert U.DEFAULT_SOURCE_OBJECT in U.BASE_CTE


def test_warmer_only_runs_while_rim_docs_is_used(monkeypatch):
    import unstructured as U
    runs = []
    monkeypatch.setattr(U, "_config", {"x": 1})
    monkeypatch.setattr(U, "WARM_SECONDS", 0.05)
    monkeypatch.setattr(U, "WARM_IDLE_SECONDS", 0.2)
    monkeypatch.setattr(U, "warm_default_page", lambda: runs.append(1) or 9)
    monkeypatch.setattr(U, "_last_used", 0.0)
    monkeypatch.setattr(U, "_warm_thread", None)
    U.start_warmer()
    try:
        _time.sleep(0.3)
        assert len(runs) == 1  # startup warm only, nobody is using it
        U._mark_used()
        _time.sleep(0.15)
        assert len(runs) >= 2
        _time.sleep(0.4)
        settled = len(runs)
        _time.sleep(0.2)
        assert len(runs) == settled  # idle again, stopped refreshing
    finally:
        U.stop_warmer()
        U._warm_thread.join(1)

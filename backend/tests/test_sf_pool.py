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

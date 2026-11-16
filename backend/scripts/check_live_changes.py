"""
Checks the speed and correctness changes against your real Snowflake and
Postgres, using the backend's own dq_config.json. Read-only: it only calls
GET endpoints (plus single-table re-validate if you ask for it, which reads
Oracle and Snowflake and saves nothing).

    cd backend
    python scripts/check_live_changes.py              # everything except re-validate
    python scripts/check_live_changes.py --revalidate # also re-validates 3 tables

Prints timings, sizes and OK / WARN / FAIL. Never prints credentials, host
names or data values, so the output is safe to paste back.
Exit code is 1 if anything failed.
"""

import argparse
import asyncio
import gzip
import json
import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

results = []


def report(status, name, detail=""):
    results.append(status)
    print(f"{status:5} {name}{'  ' + detail if detail else ''}", flush=True)


def short(e):
    # Type and a trimmed message only: no stack, no connection strings.
    return f"{type(e).__name__}: {str(e).splitlines()[0][:120]}" if str(e) else type(e).__name__


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--revalidate", action="store_true", help="also re-validate 3 tables (reads Oracle + Snowflake, saves nothing)")
    args = ap.parse_args()

    logging.disable(logging.WARNING)
    print("Loading the backend (same config the portal uses)...", flush=True)
    import app as A
    import auth as AU
    from fastapi.testclient import TestClient
    import httpx
    import uvicorn

    # Act as a user with every permission, in-process only (no token, nothing leaves this machine).
    me = {"user": {"email": "live-check@localhost", "name": "Live check"}, "token": "", "role": "admin",
          "roles": ["admin"], "groups": [], "groups_known": True,
          "permissions": {p: True for p in AU.ALL_PERMISSIONS}}
    A.app.dependency_overrides[AU.require_auth] = lambda: me
    client = TestClient(A.app)

    # Count new Snowflake logins made by the IT Checks pool.
    logins = {"n": 0}
    real_connect = A.it_report_pool._connect

    def counting_connect():
        logins["n"] += 1
        return real_connect()
    A.it_report_pool._connect = counting_connect

    print("\n== IT Checks (Snowflake) ==", flush=True)
    try:
        t = time.time()
        r = client.get("/dq/validation_report_dates")
        dates_s = time.time() - t
        r.raise_for_status()
        runs = r.json().get("runs", [])
        report("OK", "run list", f"{len(runs)} runs in {dates_s:.2f}s")
    except Exception as e:
        report("FAIL", "run list", short(e))
        runs = []

    report_json = None
    try:
        times = []
        for i in range(3):
            t = time.time()
            r = client.get("/dq/validation_report", headers={"Accept-Encoding": "identity"})
            times.append(time.time() - t)
            r.raise_for_status()
        raw = r.content
        report_json = r.json()
        rd = report_json.get("report_data") or {}
        tables = sum(len((p.get("validation_results") or {}).get("table_validations") or []) for p in rd.get("pipeline_results") or [])
        report("OK", "all runs combined", f"{report_json.get('runs_merged')} runs, {tables} tables")
        report("OK", "load time", f"first {times[0]:.2f}s, then {times[1]:.2f}s / {times[2]:.2f}s (login reused)")

        # What FastAPI's default encoder would have cost on this exact payload.
        from fastapi.encoders import jsonable_encoder
        t = time.time(); json.dumps(jsonable_encoder(report_json)).encode(); old_enc = time.time() - t
        import orjson
        t = time.time(); orjson.dumps(report_json, default=str); new_enc = time.time() - t
        report("OK", "response encoding", f"old way {old_enc:.2f}s -> now {new_enc:.3f}s (saved {old_enc - new_enc:.2f}s per load)")

        gz = client.get("/dq/validation_report", headers={"Accept-Encoding": "gzip"})
        sent = int(gz.headers.get("content-length") or len(gzip.compress(raw)))
        same = gz.json() == report_json
        enc = gz.headers.get("content-encoding")
        report("OK" if enc == "gzip" and same else "FAIL", "gzip",
               f"{len(raw) / 1e6:.2f} MB -> {sent / 1e6:.2f} MB over the wire ({len(raw) / max(sent, 1):.0f}x smaller), data identical: {same}")
    except Exception as e:
        report("FAIL", "IT Checks report", short(e))

    if runs:
        try:
            one = runs[0]["load_date"]
            t = time.time()
            r = client.get("/dq/validation_report", params={"load_date": one})
            r.raise_for_status()
            report("OK", "single run", f"loaded in {time.time() - t:.2f}s")
        except Exception as e:
            report("FAIL", "single run", short(e))

    if report_json is not None:
        report("OK" if logins["n"] <= 1 else "WARN", "Snowflake logins for all calls above", f"{logins['n']} (was one per call before)")

    if args.revalidate and report_json:
        print("\n== Single-table re-validate (reads Oracle + Snowflake, saves nothing) ==", flush=True)
        before = logins["n"]
        picked = []
        for p in report_json["report_data"].get("pipeline_results") or []:
            for tv in (p.get("validation_results") or {}).get("table_validations") or []:
                if len(picked) < 3 and tv.get("status") == "PASSED":
                    picked.append((p, tv))
        for p, tv in picked:
            body = {
                "pipeline_name": p.get("pipeline_name", ""),
                "table_name": tv.get("table_name", ""),
                "source_schema": tv.get("_oracle_schema") or p.get("oracle_schema", ""),
                "target_database": tv.get("_snowflake_database") or p.get("snowflake_database", ""),
                "target_schema": tv.get("_snowflake_schema") or p.get("snowflake_schema", ""),
                "snowflake_table": tv.get("snowflake_table") or tv.get("table_name", ""),
                "source_db": tv.get("_source_db", ""),
            }
            t = time.time()
            r = client.post("/dq/validate_single_table", json=body)
            status = (r.json().get("validation_result") or {}).get("status") if r.status_code == 200 else f"HTTP {r.status_code}"
            report("OK" if r.status_code == 200 else "WARN", f"re-validate table #{picked.index((p, tv)) + 1}", f"{status} in {time.time() - t:.2f}s")
        made = logins["n"] - before
        report("OK" if made <= 1 else "WARN", "Snowflake logins for those re-validations", f"{made} (was {len(picked)} before)")

    # The rest needs a real server so requests can overlap.
    port = free_port()
    srv = uvicorn.Server(uvicorn.Config(A.app, host="127.0.0.1", port=port, log_level="critical", log_config=None))
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.1)

    @A.app.get("/__live_check_ping")
    async def _ping():
        return {"ok": 1}

    base = f"http://127.0.0.1:{port}"
    print("\n== Business Checks reports: does a slow query freeze other requests? ==", flush=True)
    asyncio.run(check_no_freeze(base, httpx))

    print("\n== Explorers: do a page's requests run side by side? ==", flush=True)
    pages = {
        "RIM Docs (Snowflake)": [f"/api/unstructured/{p}?bypass_cache=true" for p in
                                 ("summary", "chart/domain-status", "chart/therapeutic-area",
                                  "chart/domain-distinct-objects", "chart/therapeutic-area-domain", "chart/ingestion-status")],
        "FDA (Postgres)": ["/api/fda/summary", "/api/fda/charts/decision", "/api/fda/charts/method", "/api/fda/charts/top-sponsors?limit=10"],
        "NIPO (Postgres)": ["/api/nipo/summary", "/api/nipo/charts/by-indication", "/api/nipo/charts/by-application-type", "/api/nipo/facets"],
        "EPOD (Postgres)": ["/api/epod/summary", "/api/epod/charts/chunk-level", "/api/epod/charts/content-types", "/api/epod/charts/top-documents?limit=10"],
        "HAQ (Postgres)": ["/api/haq/summary", "/api/haq/facets", "/api/haq/data?page=1&page_size=50"],
    }
    for name, urls in pages.items():
        asyncio.run(check_parallel(base, httpx, name, urls))

    srv.should_exit = True
    fails = results.count("FAIL")
    warns = results.count("WARN")
    print(f"\n{len(results) - fails - warns} OK, {warns} WARN, {fails} FAIL")
    sys.exit(1 if fails else 0)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


async def check_no_freeze(base, httpx):
    async with httpx.AsyncClient(base_url=base, timeout=300) as c:
        try:
            slow = asyncio.create_task(c.get("/api/consolidated-report/history"))
            await asyncio.sleep(0.05)
            worst = 0.0
            while not slow.done():
                t = time.time()
                await c.get("/__live_check_ping")
                worst = max(worst, time.time() - t)
                await asyncio.sleep(0.05)
            r = await slow
            if r.status_code == 503:
                report("WARN", "report history", "Business Checks not configured here, skipped")
                return
            report("OK" if worst < 0.5 else "FAIL", "other requests while report history loads",
                   f"slowest waited {worst:.2f}s (history itself HTTP {r.status_code})")
        except Exception as e:
            report("FAIL", "report history", short(e))


async def _get(c, url, httpx):
    # A server-side error can close the keep-alive connection under us; retry once.
    try:
        return await c.get(url)
    except httpx.TransportError:
        return await c.get(url)


async def check_parallel(base, httpx, name, urls):
    async with httpx.AsyncClient(base_url=base, timeout=300) as c:
        try:
            first = await _get(c, urls[0], httpx)
            if first.status_code in (502, 503):
                report("WARN", name, f"not configured or unreachable here (HTTP {first.status_code}), skipped")
                return
            one_by_one = []
            for u in urls:
                t = time.time()
                r = await _get(c, u, httpx)
                one_by_one.append(time.time() - t)
                if r.status_code >= 400:
                    report("WARN", name, f"{u.split('?')[0]} returned HTTP {r.status_code}")
            t = time.time()
            rs = await asyncio.gather(*(_get(c, u, httpx) for u in urls))
            together = time.time() - t
            ok = all(r.status_code < 400 for r in rs)
            total, slowest = sum(one_by_one), max(one_by_one)
            # Side by side means close to the slowest single call, not their sum.
            side_by_side = together < slowest + 0.5 * (total - slowest) + 0.15
            report("OK" if ok and side_by_side else "WARN", name,
                   f"{len(urls)} calls: one after another {total:.2f}s, all at once {together:.2f}s (slowest single {slowest:.2f}s)")
        except Exception as e:
            report("FAIL", name, f"{short(e)} (last call: {getattr(getattr(e, 'request', None), 'url', '?')})")


if __name__ == "__main__":
    main()

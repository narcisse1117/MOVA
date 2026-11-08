"""API 서버: 시각 변환, 설정, 장소 검색, 정산, 요청 제한, CORS."""
import datetime as dt

import pytest
from fastapi.testclient import TestClient

import server.app as app_mod
from conftest import needs_data

KST = app_mod.KST


@pytest.fixture()
def client(monkeypatch):
    app_mod._hits.clear()
    return TestClient(app_mod.app)


def test_service_day_rolls_back_before_3am():
    day, sec, dtype = app_mod.service_day(dt.datetime(2026, 11, 10, 0, 30, tzinfo=KST))   # 화요일 00:30
    assert day == dt.date(2026, 11, 9) and sec == 24 * 3600 + 30 * 60 and dtype == "WD"
    assert app_mod.service_day(dt.datetime(2026, 11, 14, 23, 0, tzinfo=KST))[2] == "SAT"
    assert app_mod.service_day(dt.datetime(2026, 11, 15, 23, 0, tzinfo=KST))[2] == "HOL"   # 일요일
    assert app_mod.service_day(dt.datetime(2026, 12, 25, 23, 0, tzinfo=KST))[2] == "HOL"   # 성탄절
    assert app_mod.to_iso(dt.date(2026, 11, 9), 24 * 3600 + 30 * 60) == "2026-11-10T00:30:00+09:00"


def test_config_service_name(client):
    assert client.get("/api/config").json()["service_name"] == "MOVA"


@needs_data
def test_geocode_station(client):
    r = client.get("/api/geocode", params={"q": "강남역"}).json()
    assert r["results"][0]["kind"] == "station"
    assert abs(r["results"][0]["lat"] - 37.4977) < 0.01


def test_settle_endpoint(client):
    body = {"riders": [{"nickname": "철수", "estimated_meter": 28500},
                       {"nickname": "민수", "estimated_meter": 33300},
                       {"nickname": "수진", "estimated_meter": 36800, "actual_meter": None}],
            "total_fare": 38600}
    r = client.post("/api/settle", json=body).json()
    assert r["payer"] == "수진" and r["method"] == "estimated_ratio"
    assert sum(s["share"] for s in r["shares"]) == 38600
    assert [t["from"] for t in r["transfers"]] == ["철수", "민수"]


def test_settle_rejects_more_than_four(client):
    body = {"riders": [{"nickname": str(i)} for i in range(5)], "total_fare": 30000}
    assert client.post("/api/settle", json=body).status_code == 422


def test_rate_limit_returns_429(client):
    per_min = app_mod.LIMITS["light"][0]
    codes = [client.get("/api/reverse", params={"lat": 37.5, "lng": 127.0}).status_code for _ in range(per_min + 1)]
    assert codes[:per_min].count(200) == per_min
    assert codes[-1] == 429


def test_cors_only_allowed_origins(client):
    ok = client.options("/api/routes", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    vercel = client.options("/api/routes", headers={"Origin": "https://mova.vercel.app", "Access-Control-Request-Method": "POST"})
    bad = client.options("/api/routes", headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert vercel.headers.get("access-control-allow-origin") == "https://mova.vercel.app"
    assert bad.status_code == 400

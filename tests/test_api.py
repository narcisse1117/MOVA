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


def test_region_of_address():
    assert app_mod.region_of("서울특별시 강남구 강남대로 396") == "서울 강남구"
    assert app_mod.region_of("경기도 성남시 분당구 성남대로 지하 333") == "경기 성남시 분당구"
    assert app_mod.region_of("") is None


def test_geocode_keeps_outside_seoul_flagged(client, monkeypatch):
    # 서울 밖도 돌려주되 in_seoul=false, 서울 안이 먼저
    monkeypatch.setattr(app_mod.naver, "local_search", lambda q: [
        {"name": "판교 카페", "address": "경기도 성남시 분당구 판교역로 1", "category": "카페", "lat": 37.39, "lng": 127.11},
        {"name": "강남 카페", "address": "서울특별시 강남구 테헤란로 1", "category": "카페", "lat": 37.50, "lng": 127.03}])
    r = client.get("/api/geocode", params={"q": "없는역이름카페"}).json()["results"]
    assert [x["in_seoul"] for x in r] == [True, False]
    assert r[0]["region"] == "서울 강남구" and r[1]["region"] == "경기 성남시 분당구"


def test_resolve_time_clock_only():
    mon_14 = dt.datetime(2026, 11, 16, 14, 0, tzinfo=KST)          # 월 14:00
    assert app_mod.resolve_time("23:40", mon_14) == dt.datetime(2026, 11, 16, 23, 40, tzinfo=KST)
    assert app_mod.resolve_time("00:30", mon_14) == dt.datetime(2026, 11, 17, 0, 30, tzinfo=KST)   # 같은 밤 새벽
    tue_0010 = dt.datetime(2026, 11, 17, 0, 10, tzinfo=KST)        # 화 00:10 (월요일 밤)
    assert app_mod.resolve_time("00:30", tue_0010) == dt.datetime(2026, 11, 17, 0, 30, tzinfo=KST)
    assert app_mod.resolve_time("23:50", tue_0010) == dt.datetime(2026, 11, 16, 23, 50, tzinfo=KST)  # 20분 전: 그대로
    assert app_mod.resolve_time("23:00", tue_0010) == dt.datetime(2026, 11, 17, 23, 0, tzinfo=KST)   # 지났음: 다음 밤
    assert app_mod.resolve_time("now", mon_14) == mon_14 and app_mod.resolve_time(None, mon_14) == mon_14
    with pytest.raises(ValueError):
        app_mod.resolve_time("25:00", mon_14)


def test_routes_rejects_bad_time(client):
    body = {"origin": {"lat": 37.55, "lng": 126.92}, "destination": {"lat": 37.65, "lng": 127.06}, "departure_time": "밤"}
    assert client.post("/api/routes", json=body).status_code == 422


def test_resolve_time_iso_string():
    assert app_mod.resolve_time("2026-11-09T23:30") == dt.datetime(2026, 11, 9, 23, 30, tzinfo=KST)
    assert app_mod.resolve_time("2026-11-09T14:30:00Z") == dt.datetime(2026, 11, 9, 23, 30, tzinfo=KST)


def test_routes_time_omitted_means_now():
    req = app_mod.RouteRequest(origin={"lat": 37.55, "lng": 126.92}, destination={"lat": 37.65, "lng": 127.06})
    assert abs((req.departure_time - dt.datetime.now(KST)).total_seconds()) < 5

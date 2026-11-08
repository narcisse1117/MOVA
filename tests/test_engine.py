"""경로 엔진: 공식 값 거르기, 네이버 대조로 확인한 경로, 출발 마감, 택시 조합."""
import numpy as np

import deadline
import network
import raptor
from conftest import needs_data

HONGDAE = (37.557192, 126.925381)
JAMSIL = (37.513977, 127.102198)
SINLIM = (37.484201, 126.929715)
NOWON = (37.655128, 127.061368)


def test_clean_monotone_drops_outliers():
    nan = np.nan
    v = np.array([nan, 100, 200, 15, 300, 400, 250, 500], dtype=float)
    out = network.clean_monotone(v, slack=0)
    kept = out[~np.isnan(out)]
    assert list(kept) == [100, 200, 300, 400, 500]


def test_fill_along_interpolates():
    v = np.array([np.nan, 10, np.nan, 30, np.nan])
    assert list(network.fill_along(v)) == [10, 10, 20, 30, 30]


@needs_data
def test_hongdae_to_jamsil_matches_naver(net_wd):
    # 2026-11-08 네이버 대조: 2호선 23:42 홍대입구 → 00:21 잠실
    res = raptor.query(net_wd, HONGDAE, JAMSIL, 23 * 3600 + 30 * 60)
    best = min(res, key=lambda r: r["arrive"])
    assert abs(best["arrive"] - (24 * 3600 + 23 * 60)) <= 5 * 60
    rides = [l for l in best["legs"] if l["type"] in ("rail", "bus")]
    assert rides[0]["line"] == "2호선"


@needs_data
def test_sinlim_to_nowon_arrival(net_wd):
    # 네이버: 01:00 도착 (갈아타는 역은 달라도 됨)
    res = raptor.query(net_wd, SINLIM, NOWON, 23 * 3600 + 50 * 60)
    best = min(res, key=lambda r: r["arrive"])
    assert abs(best["arrive"] - 25 * 3600) <= 5 * 60


@needs_data
def test_no_airport_or_tour_bus(net_wd):
    for r in net_wd.routes:
        if r.kind == "bus":
            assert r.route_type not in network.EXCLUDED_BUS_TYPES


@needs_data
def test_blocked_trips_never_boarded(net_wd):
    # 단축 운행으로 막힌 운행(INF)을 타는 경로가 나오면 안 된다
    res = raptor.query(net_wd, HONGDAE, (37.476, 126.9816), 25 * 3600)      # 홍대 → 사당 01:00
    for r in res:
        for l in r["legs"]:
            if l["type"] in ("rail", "bus"):
                assert l["dep"] < raptor.INF and l["arr"] >= l["dep"]
        assert r["arrive"] > 25 * 3600


@needs_data
def test_deadline_regular_before_last_train(net_wd):
    d = deadline.deadlines(net_wd, HONGDAE, NOWON, 21 * 3600)
    reg = d["regular"]
    assert reg is not None
    assert 23 * 3600 < reg["latest"] < 26 * 3600
    assert reg["leave_by"] == reg["latest"] - deadline.BUFFER_MIN * 60
    # 마지막 경로에 심야버스가 없어야 한다
    assert not any(l.get("line", "").startswith("N") for l in reg["route"]["legs"])


@needs_data
def test_plan_has_taxi_transit_and_cheaper_combo(net_wd):
    p = raptor.plan(net_wd, HONGDAE, NOWON, 24 * 3600 + 30 * 60)
    assert p["taxi_direct"]["fare"] > 20000
    assert p["transit"]
    for c in p["combo"]:
        assert c["fare"] < p["taxi_direct"]["fare"]
        assert c["combo_kind"] in ("taxi_first", "taxi_last", "taxi_both")
        assert sum(1 for c in p["combo"] if c["recommended"]) == 1


def test_subway_message_parsing():
    import realtime
    assert realtime._parse_msg_sec("4분 30초 후") == 270
    assert realtime._parse_msg_sec("3분 후") == 180
    assert realtime._parse_msg_sec("강남 도착") == 0
    assert realtime._parse_msg_sec("[3]번째 전역 (청계산입구)") is None


def test_subway_realtime_matches_train_number(monkeypatch):
    import realtime
    trains = [{"line_id": "1002", "train": "2309", "terminus": "성수", "sec": 300, "is_last": False, "msg": "5분 후"},
              {"line_id": "1002", "train": "2311", "terminus": "성수", "sec": 600, "is_last": True, "msg": "10분 후"}]
    monkeypatch.setattr(realtime, "subway_arrivals", lambda st: trains)
    leg = {"type": "rail", "line": "2호선", "trip": "2311 성수행", "from": "홍대입구", "dep": 1000 + 540}
    info = realtime._annotate_rail(leg, lead=120, now_sec=1000)
    assert info["matched"] == "train" and info["is_last"] and info["arrive_in_sec"] == 600
    leg2 = dict(leg, trip="9999 성수행")                      # 번호가 없으면 같은 행선지 첫 열차
    assert realtime._annotate_rail(leg2, lead=120, now_sec=1000)["matched"] == "direction"
    assert realtime._annotate_rail(leg, lead=700, now_sec=1000)["status"] == "missed"

"""심야버스 실측 시간표: 도착 예정 기록 → 운행별 통과 시각."""
import csv
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prep"))
import build_night_timetable as bnt  # noqa: E402

FIELDS = ["obs_time", "route_id", "route_no", "sta_ord", "st_id", "st_nm", "veh1", "plate1", "tra_sec1",
          "is_arrive1", "sect_ord1", "is_last1", "msg1", "veh2", "plate2", "tra_sec2", "is_last2", "msg2"]


def fake_raw(path, base):
    """차량 V1이 23:30, 01:30에 두 바퀴(정류장 10개, 정류장마다 3분). 5분마다 관측."""
    passes = {(k, o): base + dt.timedelta(hours=23, minutes=30 + 120 * k + 3 * (o - 1))
              for k in range(2) for o in range(1, 11)}
    rows = []
    t = base + dt.timedelta(hours=23)
    while t < base + dt.timedelta(hours=28):
        for o in range(1, 11):
            nxt = sorted(v for (k, oo), v in passes.items() if oo == o and v >= t)
            if not nxt:
                continue
            tra = int((nxt[0] - t).total_seconds())
            rows.append({"obs_time": t.isoformat(), "route_id": "R1", "route_no": "N99", "sta_ord": o,
                         "st_id": f"S{o}", "veh1": "V1", "tra_sec1": tra + 20, "is_arrive1": 0, "msg1": "x"})
        t += dt.timedelta(minutes=5)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    return passes


def test_two_laps_become_two_trips(tmp_path, monkeypatch):
    base = dt.datetime(2026, 11, 8)
    raw = tmp_path / "night_bus_raw_20261108.csv"
    passes = fake_raw(raw, base)
    monkeypatch.setattr(bnt, "DATA", str(tmp_path))
    out = bnt.build(str(raw))
    assert out.endswith("_HOL.csv")                     # 2026-11-08은 일요일
    rows = list(csv.DictReader(open(out, encoding="utf-8-sig")))
    trips = {r["trip"] for r in rows}
    assert len(trips) == 2
    for r in rows:                                      # 관측 오차(20초) + 5분 간격 안
        o = int(r["sta_ord"])
        true = [(v - base).total_seconds() for (k, oo), v in passes.items() if oo == o]
        assert min(abs(int(r["sec"]) - x) for x in true) <= 60

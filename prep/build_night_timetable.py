"""
심야버스(N) 실제 시간표 만들기: collect_night_bus.py가 모은 도착 예정 기록 → 운행별 정류장 통과 시각.

방법
  1) 기록 한 줄 = (관측 시각, 정류장, 다음 버스 차량 ID, 남은 초). 관측 시각 + 남은 초 = 그 차량이 그 정류장을 지날 예정 시각
  2) 같은 차량·정류장 예정값을 시각순으로 묶는다(PASS_GAP_SEC 넘게 벌어지면 다른 통과 = 다음 바퀴).
     한 통과에서는 남은 초가 가장 작은 값(가장 가까이서 본 값)을 쓴다. 남은 초가 MAX_TRA_SEC보다 크면 쓰지 않는다
  3) 차량의 통과를 시각순으로 놓고 정류장 순번이 크게 줄면 새 운행(한 밤에 여러 바퀴)
  4) 운행마다 정류장 순서대로 시각이 늘어나게 다듬고, 통과가 MIN_STOPS개 미만인 운행은 버린다

실행:  python prep/build_night_timetable.py                       (데이터/night_bus_raw_*.csv 전부)
       python prep/build_night_timetable.py 데이터/night_bus_raw_20261108.csv
출력:  데이터/night_bus_trips_YYYYMMDD_<WD|SAT|HOL>.csv
       route_id, route_no, trip, sta_ord, st_id, sec(운행일 0시 기준 초), tra_sec(그 값을 본 남은 초)
"""
import csv
import datetime as dt
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

PREP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(PREP)
DATA = os.path.join(ROOT, "데이터")
sys.path.insert(0, os.path.join(ROOT, "engine"))
from network import clean_monotone  # noqa: E402

MAX_TRA_SEC = 900      # 15분 넘게 남은 예정값은 부정확해서 안 쓴다
PASS_GAP_SEC = 1200    # 같은 차량·정류장 예정값이 20분 넘게 벌어지면 다른 바퀴
MIN_STOPS = 5
SKIP_MSG = ("출발대기", "운행종료", "회차대기")


def day_type(d):
    hol = set(json.load(open(os.path.join(ROOT, "config", "app.json"), encoding="utf-8"))["holidays"])
    if d.isoformat() in hol or d.weekday() == 6:
        return "HOL"
    return "SAT" if d.weekday() == 5 else "WD"


def read_raw(path, base):
    """→ {(route_id, veh): [(est_sec, sta_ord, st_id, tra_sec)]}, {route_id: route_no}"""
    est = defaultdict(list)
    names = {}
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                obs = (dt.datetime.fromisoformat(r["obs_time"]) - base).total_seconds()
                ord_ = int(r["sta_ord"])
            except (ValueError, TypeError):
                continue
            names[r["route_id"]] = r["route_no"]
            for n in ("1", "2"):
                veh, msg = (r.get("veh" + n) or "").strip(), r.get("msg" + n) or ""
                if not veh or veh == "0" or any(s in msg for s in SKIP_MSG):
                    continue
                try:
                    tra = int(float(r.get("tra_sec" + n) or 0))
                except ValueError:
                    continue
                if n == "1" and str(r.get("is_arrive1")) == "1":
                    tra = 0
                elif tra <= 0 and "곧 도착" not in msg:
                    continue
                if tra > MAX_TRA_SEC:
                    continue
                est[(r["route_id"], veh)].append((obs + tra, ord_, r["st_id"], tra))
    return est, names


def passes(rows):
    """한 차량의 예정값 → 정류장 통과 목록 [(sec, ord, st_id, tra)]"""
    by_stop = defaultdict(list)
    for e in rows:
        by_stop[(e[1], e[2])].append(e)
    out = []
    for es in by_stop.values():
        es.sort()
        group = [es[0]]
        for e in es[1:] + [None]:
            if e is not None and e[0] - group[-1][0] <= PASS_GAP_SEC:
                group.append(e)
                continue
            out.append(min(group, key=lambda x: x[3]))
            if e is not None:
                group = [e]
    return sorted(out)


def split_trips(ps):
    """통과 목록(시각순)을 운행별로 나눈다: 순번이 크게 줄면 새 운행."""
    if not ps:
        return []
    max_ord = max(p[1] for p in ps)
    tol = max(5, int(0.2 * max_ord))
    trips, cur, hi = [], [ps[0]], ps[0][1]
    for p in ps[1:]:
        if p[1] < hi - tol:
            trips.append(cur)
            cur, hi = [p], p[1]
        else:
            cur.append(p)
            hi = max(hi, p[1])
    trips.append(cur)
    return trips


def clean_trip(trip):
    """순번 하나에 값 하나, 순번 순서대로 시각이 늘게."""
    best = {}
    for p in trip:
        if p[1] not in best or p[3] < best[p[1]][3]:
            best[p[1]] = p
    rows = [best[k] for k in sorted(best)]
    v = clean_monotone(np.array([r[0] for r in rows], dtype=float), slack=60)
    return [r for r, x in zip(rows, v) if not np.isnan(x)]


def build(path):
    date = dt.datetime.strptime(os.path.basename(path).split("_")[3][:8], "%Y%m%d")
    est, names = read_raw(path, date)
    out_rows = []
    per_route = defaultdict(int)
    for (rid, veh), rows in est.items():
        for trip in split_trips(passes(rows)):
            trip = clean_trip(trip)
            if len(trip) < MIN_STOPS:
                continue
            per_route[rid] += 1
            tno = f"{veh}-{int(trip[0][0])}"
            for sec, ord_, st, tra in trip:
                out_rows.append({"route_id": rid, "route_no": names[rid], "trip": tno, "sta_ord": ord_,
                                 "st_id": st, "sec": int(round(sec)), "tra_sec": tra})
    out = os.path.join(DATA, f"night_bus_trips_{date:%Y%m%d}_{day_type(date.date())}.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["route_id", "route_no", "trip", "sta_ord", "st_id", "sec", "tra_sec"])
        w.writeheader()
        w.writerows(out_rows)
    print(f"{os.path.basename(path)} → {os.path.basename(out)}: 노선 {len(per_route)}개, 운행 {sum(per_route.values())}개")
    for rid in sorted(per_route, key=lambda x: names[x]):
        print(f"  {names[rid]:>6}  운행 {per_route[rid]}")
    return out


def main():
    paths = sys.argv[1:] or sorted(glob.glob(os.path.join(DATA, "night_bus_raw_*.csv")))
    if not paths:
        print("night_bus_raw_*.csv 없음")
    for p in paths:
        build(p)


if __name__ == "__main__":
    main()

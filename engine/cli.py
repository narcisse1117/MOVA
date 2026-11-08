"""
경로 탐색 시험용.

  python engine/cli.py --from 홍대입구 --to "잠실(송파구청)" --time 23:30
  python engine/cli.py --from 37.5572,126.9245 --to 37.5133,127.1001 --time 00:10 --day SAT
  python engine/cli.py --from 강남 --to 노원 --time 22:00 --deadline   (출발 마감 시각)

--from/--to: 역 이름(앞부분이 같으면 됨) 또는 '위도,경도'
--time: 03시 이전은 전날 운행일의 24시 이후로 본다
"""
import argparse
import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deadline  # noqa: E402
import network  # noqa: E402
import raptor  # noqa: E402
import realtime  # noqa: E402


def parse_place(text):
    if "," in text:
        lat, lon = map(float, text.split(","))
        return (lat, lon), text
    st = pd.read_csv(os.path.join(network.PREP_OUT, "stations.csv"), dtype={"place_id": str})
    m = st[st.name == text]
    if m.empty:
        m = st[st.name.str.startswith(text)]
    if m.empty:
        raise SystemExit(f"역을 찾을 수 없습니다: {text}")
    r = m.iloc[0]
    return (r.lat, r.lng), r["name"]


def parse_time(text):
    h, m = map(int, text.split(":"))
    sec = h * 3600 + m * 60
    return sec + 86400 if h < 3 else sec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True)
    ap.add_argument("--to", dest="dst", required=True)
    ap.add_argument("--time", help="HH:MM. 빼면 지금 (실시간 반영)")
    ap.add_argument("--day", default="WD", choices=["WD", "SAT", "HOL"])
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--deadline", action="store_true", help="--time 이후 몇 시까지 출발하면 대중교통으로 갈 수 있는지")
    a = ap.parse_args()

    t = time.time()
    net = network.load(a.day, rebuild=a.rebuild)
    load_s = time.time() - t
    live = a.time is None
    if live:
        import datetime as _dt
        n = _dt.datetime.now()
        a.time = f"{n.hour:02d}:{n.minute:02d}"
    (o, oname), (d, dname), t0 = parse_place(a.src), parse_place(a.dst), parse_time(a.time)
    t = time.time()
    if a.deadline:
        res = deadline.deadlines(net, o, d, t0)
        print(f"{oname} → {dname}, {a.day} {network.fmt(t0)} 이후 출발 마감 (탐색 {time.time() - t:.1f}초)")
        print(deadline.describe(res))
        return
    res = raptor.plan(net, o, d, t0, live=live)
    if live:
        realtime.annotate_plan(res, t0)
    q_s = time.time() - t
    print(f"{oname} → {dname}, {a.day} {network.fmt(t0)} 출발 (노선망 {load_s:.1f}초, 탐색 {q_s:.2f}초)")
    print(raptor.describe_plan(res))


if __name__ == "__main__":
    main()

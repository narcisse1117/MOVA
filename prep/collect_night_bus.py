"""
심야버스(N) 실제 정류장 통과 시각 수집.

버스도착정보조회 getArrInfoByRouteAll을 POLL_MIN분마다 불러, 정류장마다 다음 버스 두 대의
차량 ID와 도착 예정(초)을 기록한다. 나중에 차량별로 '정류장을 지난 시각'을 모으면 실제 시간표가 된다.

  실행:  python prep/collect_night_bus.py               (23:00~04:30, 그 전이면 기다렸다 시작)
         python prep/collect_night_bus.py --now         (바로 시작, 시험용)
  출력:  데이터/night_bus_raw_YYYYMMDD.csv  (운행일 기준 날짜)
  호출:  노선 18개 × 12번/시간 × 5.5시간 ≈ 1,200건. 키(seoul_key2.txt 줄마다)를 돌려 쓰고, 한 키가 막히면 다음 키
  주의:  이 컴퓨터와 실행한 창이 밤새 켜져 있어야 한다
"""
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PREP = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(PREP), "데이터")
URL = "http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll"
POLL_MIN = 5
START, END = dt.time(23, 0), dt.time(4, 30)
FIELDS = ["obs_time", "route_id", "route_no", "sta_ord", "st_id", "st_nm",
          "veh1", "plate1", "tra_sec1", "is_arrive1", "sect_ord1", "is_last1", "msg1",
          "veh2", "plate2", "tra_sec2", "is_last2", "msg2"]


def in_window(t):
    return t >= START or t <= END


def main():
    now_mode = "--now" in sys.argv
    keys = open(os.path.join(DATA, "seoul_key2.txt"), encoding="utf-8-sig").read().split()
    with open(os.path.join(PREP, "out", "bus_routes.csv"), encoding="utf-8-sig") as f:
        routes = [(r["route_id"], r["route_no"]) for r in csv.DictReader(f) if r["route_no"].startswith("N")]
    print(f"심야버스 {len(routes)}개 노선, {POLL_MIN}분마다", flush=True)

    if not now_mode:
        while not in_window(dt.datetime.now().time()):
            time.sleep(60)
    key_i, calls, started = 0, 0, dt.datetime.now()
    service_day = (started - dt.timedelta(hours=12)).date() if started.hour < 12 else started.date()
    out = os.path.join(DATA, f"night_bus_raw_{service_day:%Y%m%d}.csv")
    new = not os.path.exists(out)
    print(f"시작 {started:%H:%M} → {os.path.basename(out)}", flush=True)
    with open(out, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        while True:
            t0 = time.time()
            now = dt.datetime.now()
            if not now_mode and not in_window(now.time()):
                break
            if now_mode and now - started > dt.timedelta(minutes=POLL_MIN * 2):
                break
            for rid, rno in routes:
                items = None
                for _ in range(len(keys)):
                    q = urllib.parse.urlencode({"serviceKey": keys[key_i], "busRouteId": rid, "resultType": "json"})
                    try:
                        j = json.loads(urllib.request.urlopen(f"{URL}?{q}", timeout=20).read())
                        calls += 1
                        hd = str((j.get("msgHeader") or {}).get("headerCd"))
                        if hd in ("0", "4"):
                            items = (j.get("msgBody") or {}).get("itemList") or []
                            break
                        print(f"  {rno} headerCd={hd} → 다음 키", flush=True)
                    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                        print(f"  {rno} 오류 {e!r} → 다음 키", flush=True)
                    key_i = (key_i + 1) % len(keys)
                if items is None:
                    continue
                obs = dt.datetime.now().isoformat(timespec="seconds")
                for x in items:
                    w.writerow({"obs_time": obs, "route_id": rid, "route_no": rno, "sta_ord": x.get("staOrd"),
                                "st_id": x.get("stId"), "st_nm": x.get("stNm"),
                                "veh1": x.get("vehId1"), "plate1": x.get("plainNo1"), "tra_sec1": x.get("traTime1"),
                                "is_arrive1": x.get("isArrive1"), "sect_ord1": x.get("sectOrd1"),
                                "is_last1": x.get("isLast1"), "msg1": x.get("arrmsg1"),
                                "veh2": x.get("vehId2"), "plate2": x.get("plainNo2"), "tra_sec2": x.get("traTime2"),
                                "is_last2": x.get("isLast2"), "msg2": x.get("arrmsg2")})
                time.sleep(0.3)
            f.flush()
            print(f"{now:%H:%M} 한 바퀴 끝 (누적 호출 {calls})", flush=True)
            time.sleep(max(0, POLL_MIN * 60 - (time.time() - t0)))
    print(f"끝. 호출 {calls}건", flush=True)


if __name__ == "__main__":
    main()

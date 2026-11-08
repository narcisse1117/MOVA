"""
서울 버스 노선마다 정류장별 첫차·막차 예정 시각을 받는다 (버스도착정보조회 getArrInfoByRouteAll).

API는 조회한 날의 운행 기준 시각을 준다. 평일·토요일·공휴일 값을 모두 모으려면 그날마다 한 번씩 돌린다.
  평일(WD): 월~금 / 토요일(SAT) / 공휴일(HOL): 일요일·공휴일

인증키: 데이터/seoul_key2.txt 첫 줄 (공공데이터포털 키, 채팅에 붙이지 않는다)
출력:   데이터/bus_stop_times_YYYYMMDD_<WD|SAT|HOL>.csv
실행:   python prep/fetch_bus_times.py            (이미 받은 노선은 건너뛴다)
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
HOLIDAYS = {"20261003", "20261005", "20261009", "20261225"}
FIELDS = ["route_id", "route_no", "sta_ord", "st_id", "ars_id", "st_nm", "first_tm", "last_tm", "term", "dir"]


def daytype(d):
    s = d.strftime("%Y%m%d")
    if s in HOLIDAYS or d.weekday() == 6:
        return "HOL"
    return "SAT" if d.weekday() == 5 else "WD"


def fetch(key, route_id, tries=3):
    q = urllib.parse.urlencode({"serviceKey": key, "busRouteId": route_id, "resultType": "json"})
    for i in range(tries):
        try:
            j = json.loads(urllib.request.urlopen(f"{URL}?{q}", timeout=20).read())
            h = j.get("msgHeader") or {}
            if str(h.get("headerCd")) not in ("0", "4"):   # 4 = 결과 없음
                raise RuntimeError(f"headerCd={h.get('headerCd')} {h.get('headerMsg')}")
            return (j.get("msgBody") or {}).get("itemList") or []
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as e:
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


def main():
    # 운행일은 03시에 바뀐다
    now = dt.datetime.now()
    day = (now - dt.timedelta(hours=3)).date()
    dtype = daytype(day)
    key = open(os.path.join(DATA, "seoul_key2.txt"), encoding="utf-8-sig").read().split()[0]
    out = os.path.join(DATA, f"bus_stop_times_{day:%Y%m%d}_{dtype}.csv")

    with open(os.path.join(PREP, "out", "bus_routes.csv"), encoding="utf-8-sig") as f:
        routes = [(r["route_id"], r["route_no"]) for r in csv.DictReader(f)]
    done = set()
    if os.path.exists(out):
        with open(out, encoding="utf-8-sig") as f:
            done = {r["route_id"] for r in csv.DictReader(f)}
    todo = [r for r in routes if r[0] not in done]
    print(f"{day} ({dtype}) 노선 {len(routes)}개 중 {len(todo)}개 받기 → {os.path.basename(out)}")

    new = not os.path.exists(out)
    failed = []
    with open(out, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        for n, (rid, rno) in enumerate(todo, 1):
            try:
                items = fetch(key, rid)
            except Exception as e:  # noqa: BLE001
                failed.append(rno)
                print(f"  실패 {rno}: {e}")
                if isinstance(e, urllib.error.HTTPError) and e.code in (401, 429):
                    print("  인증 또는 호출 한도 문제로 멈춥니다. 내일 다시 실행하면 이어서 받습니다.")
                    break
                continue
            for x in items:
                w.writerow({"route_id": rid, "route_no": rno, "sta_ord": x.get("staOrd"), "st_id": x.get("stId"),
                            "ars_id": x.get("arsId"), "st_nm": x.get("stNm"), "first_tm": x.get("firstTm"),
                            "last_tm": x.get("lastTm"), "term": x.get("term"), "dir": x.get("dir")})
            if n % 50 == 0:
                f.flush()
                print(f"  {n}/{len(todo)}")
            time.sleep(0.15)
    print(f"끝. 실패 {len(failed)}개" + (f": {', '.join(failed[:20])}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

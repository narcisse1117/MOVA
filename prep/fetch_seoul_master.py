"""
서울 열린데이터광장 Open API로 버스 마스터 데이터를 받아 CSV로 저장한다.

인증키: 데이터/seoul_key.txt (한 줄). 이 파일은 GitHub에 올리지 않는다.
출력:   데이터/seoul_route_master.csv    노선 ID ↔ 노선 번호, 유형, 거리
        데이터/seoul_station_master.csv  정류장 ID, 이름, 유형, 번호, 위도·경도
        데이터/seoul_route_node.csv      노선별 정류장 순서(CRTR_SEQ), 구간 거리(LNKG_LEN, m)

실행:  python prep/fetch_seoul_master.py
"""
import csv
import json
import os
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "데이터")
PAGE = 1000  # 한 번에 받을 수 있는 최대 건수

SERVICES = {
    "tbisMasterRoute": "seoul_route_master.csv",
    "tbisMasterStation": "seoul_station_master.csv",
    "masterRouteNode": "seoul_route_node.csv",   # 노선별 정류장 순서, 구간 거리(m)
}


def call(key, svc, start, end):
    url = f"http://openapi.seoul.go.kr:8088/{key}/json/{svc}/{start}/{end}/"
    for attempt in range(3):
        try:
            data = json.loads(urllib.request.urlopen(url, timeout=30).read().decode("utf-8"))
            if svc in data:
                return data[svc]
            raise RuntimeError(data.get("RESULT"))
        except Exception as e:  # 일시 오류는 다시 시도
            if attempt == 2:
                raise
            print(f"  다시 시도 ({e})")
            time.sleep(2)


def fetch(key, svc, out_name):
    first = call(key, svc, 1, 1)
    total = int(first["list_total_count"])
    rows = []
    for start in range(1, total + 1, PAGE):
        end = min(start + PAGE - 1, total)
        rows += call(key, svc, start, end)["row"]
        print(f"  {svc}: {len(rows)}/{total}")
    path = os.path.join(DATA, out_name)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: (v.strip() if isinstance(v, str) else v) for k, v in r.items()})
    print(f"저장: {path} ({len(rows)}행)")


def main():
    with open(os.path.join(DATA, "seoul_key.txt"), encoding="utf-8") as f:
        key = f.read().strip()
    for svc, out_name in SERVICES.items():
        fetch(key, svc, out_name)


if __name__ == "__main__":
    main()

"""
프론트 전달용 응답 예시를 만든다 (실제 엔진 결과). server/examples/*.json
실행: python server/make_examples.py   (레포 최상위에서)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi.testclient import TestClient  # noqa: E402

from server.app import DB_PATH, app  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples")
HONGDAE = {"lat": 37.557192, "lng": 126.925381, "label": "홍대입구역"}
NOWON = {"lat": 37.655128, "lng": 127.061368, "label": "노원역"}
GANGNAM = {"lat": 37.497952, "lng": 127.027619, "label": "강남역"}
SINLIM = {"lat": 37.484201, "lng": 126.929715, "label": "신림역"}
SUYU = {"lat": 37.638052, "lng": 127.025732, "label": "수유역"}
DOBONG = {"lat": 37.668, "lng": 127.044, "label": "도봉구"}
BONGCHEON = {"lat": 37.4825, "lng": 126.9417, "label": "봉천동"}


def save(name, req, res):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump({"request": req, "response": res}, f, ensure_ascii=False, indent=2)
    print("saved", name)


def main():
    os.makedirs(OUT, exist_ok=True)
    c = TestClient(app)
    req = {"origin": HONGDAE, "destination": NOWON, "departure_time": "2026-11-10T00:30"}
    r = c.post("/api/routes", json=req)
    r.raise_for_status()
    save("routes_hongdae_nowon_0030.json", req, r.json())

    req = {"origin": GANGNAM, "destination": SUYU, "from_time": "2026-11-09T21:00"}
    r = c.post("/api/deadline", json=req)
    r.raise_for_status()
    save("deadline_gangnam_suyu.json", req, r.json())

    req = {"name": "송년회", "meeting_place": GANGNAM, "date": "2026-12-18"}
    g = c.post("/api/groups", json=req).json()
    people = (("민수", NOWON), ("수진", DOBONG), ("철수", SUYU), ("지영", SINLIM), ("영희", BONGCHEON), ("현우", HONGDAE))
    for nick, home in people:
        c.post(f"/api/groups/{g['id']}/members", json={"nickname": nick, "home": home}).raise_for_status()
    r = c.get(f"/api/groups/{g['id']}", params={"leave_at": "2026-12-19T01:00"})
    r.raise_for_status()
    save("group_get.json", {"create": req, "members": [f"{n}({h['label']})" for n, h in people],
                            "query": "GET /api/groups/{id}?leave_at=2026-12-19T01:00"}, r.json())

    # 내린 뒤 실제 금액 나누기: 총액만 / 내릴 때 미터기까지
    taxi = r.json()["taxi_groups"][0]
    riders = [{"nickname": x["nickname"], "member_id": x["member_id"], "estimated_meter": m}
              for x, m in zip(taxi["riders"], taxi["estimated_meters"])]
    req1 = {"riders": riders, "total_fare": taxi["total_fare"] + 1800}
    r1 = c.post("/api/settle", json=req1)
    r1.raise_for_status()
    save("settle_total_only.json", req1, r1.json())
    riders2 = [dict(x, actual_meter=m) for x, m in zip(riders, [27800, 33100, 38400])][:len(riders)]
    req2 = {"riders": riders2, "total_fare": 38400}
    r2 = c.post("/api/settle", json=req2)
    r2.raise_for_status()
    save("settle_actual_meters.json", req2, r2.json())
    print("db:", DB_PATH)


if __name__ == "__main__":
    main()

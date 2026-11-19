"""모임 API: 토큰, 주소 숨기기, 닉네임 번호, 수정·삭제, 24시간 만료, 실제 택시비·사용 기록."""
import datetime as dt

import pytest
from fastapi.testclient import TestClient

import server.app as app_mod
from conftest import needs_data

MEET = {"lat": 37.5572, "lng": 126.9245, "label": "홍대입구역"}
HOME_A = {"lat": 37.6551, "lng": 127.0614, "label": "노원구 상계동 123-4"}
HOME_B = {"lat": 37.4766, "lng": 126.9816, "label": "동작구 사당동 56"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_mod, "DB_PATH", str(tmp_path / "mova.db"))
    monkeypatch.setattr(app_mod.naver, "reverse", lambda lat, lng: {"si": "서울특별시", "gu": "테스트구", "dong": "가동"})
    app_mod._hits.clear()
    app_mod._deadline_cache.clear()
    return TestClient(app_mod.app)


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


def make(client, **kw):
    r = client.post("/api/groups", json={"name": "송년회", "meeting_place": MEET, "departure_time": "23:00", **kw})
    assert r.status_code == 200
    return r.json()


@needs_data
def test_create_join_and_privacy(client):
    g = make(client)
    assert len(g["id"]) >= 16 and g["admin_token"] and g["expires_at"]
    a = client.post(f"/api/groups/{g['id']}/members", json={"nickname": "민수", "home": HOME_A}).json()
    b = client.post(f"/api/groups/{g['id']}/members", json={"nickname": "민수", "home": HOME_B}).json()
    assert a["nickname"] == "민수" and b["nickname"] == "민수2"           # 겹치면 번호
    assert a["member_token"] != b["member_token"]

    other = client.get(f"/api/groups/{g['id']}").json()                   # 토큰 없음: 아무 집도 안 보임
    assert other["status"] == "ready" and other["version"] == 3
    assert all("home" not in m and m["area"] for m in other["members"])
    assert "상계동 123-4" not in str(other) and "37.6551" not in str(other)

    me = client.get(f"/api/groups/{g['id']}", headers=bearer(a["member_token"])).json()
    mine = [m for m in me["members"] if m["is_me"]]
    assert len(mine) == 1 and mine[0]["home"]["label"] == HOME_A["label"]
    assert client.get(f"/api/groups/{g['id']}", headers=bearer(g["admin_token"])).json()["is_admin"] is True
    reg = mine[0]["deadline"]["regular"]
    if reg:
        assert reg["extra_if_late"]["amount"] >= 0 and "더 들어요" in reg["extra_if_late"]["message"]


@needs_data
def test_update_and_remove_need_token(client):
    g = make(client)
    a = client.post(f"/api/groups/{g['id']}/members", json={"nickname": "지수", "home": HOME_A}).json()
    url = f"/api/groups/{g['id']}/members/{a['id']}"
    assert client.patch(url, json={"nickname": "지수짱"}).status_code == 403
    r = client.patch(url, json={"nickname": "지수짱", "home": HOME_B}, headers=bearer(a["member_token"]))
    assert r.status_code == 200 and r.json()["nickname"] == "지수짱"
    assert client.delete(url, headers=bearer("wrong-token")).status_code == 403
    assert client.delete(url, headers=bearer(g["admin_token"])).json()["deleted"] is True     # 만든 사람이 삭제
    assert client.get(f"/api/groups/{g['id']}").json()["members"] == []


@needs_data
def test_end_and_expire(client):
    g = make(client)
    client.post(f"/api/groups/{g['id']}/members", json={"nickname": "a", "home": HOME_A})
    assert client.delete(f"/api/groups/{g['id']}").status_code == 403
    assert client.delete(f"/api/groups/{g['id']}", headers=bearer(g["admin_token"])).json()["status"] == "ended"
    r = client.get(f"/api/groups/{g['id']}").json()
    assert r["status"] == "expired" and r["members"] == []
    assert client.post(f"/api/groups/{g['id']}/members", json={"nickname": "b", "home": HOME_B}).status_code == 410

    g2 = make(client)
    client.post(f"/api/groups/{g2['id']}/members", json={"nickname": "a", "home": HOME_A})
    past = (dt.datetime.now(app_mod.KST) - dt.timedelta(minutes=1)).isoformat()
    with app_mod.db() as con:
        con.execute("update groups set expires_at=? where id=?", (past, g2["id"]))
    assert client.get(f"/api/groups/{g2['id']}").json()["status"] == "expired"
    with app_mod.db() as con:
        assert con.execute("select count(*) from members where group_id=?", (g2["id"],)).fetchone()[0] == 0


def test_feedback_and_events(client):
    r = client.post("/api/feedback", json={"option_id": "combo-1", "option_kind": "combo", "fare_range": [9400, 10600],
                                           "actual_fare": 10200, "distance_m": 7200, "departure": "2026-11-19T00:30"})
    assert r.json()["saved"] and r.json()["within_range"] is True
    assert client.post("/api/feedback", json={"skipped": True}).json()["saved"]
    assert client.post("/api/events", json={"device_id": "dev-1234", "name": "search", "area": "마포구 서교동"}).json()["saved"]
    with app_mod.db() as con:
        row = con.execute("select distance_band, hour from feedback where option_id='combo-1'").fetchone()
    assert tuple(row) == ("5~10km", 0)

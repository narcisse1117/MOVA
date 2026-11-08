"""
API 서버 (FastAPI). 경로 엔진(engine/)을 HTTP로 연다.

실행:  python -m uvicorn server.app:app --reload --port 8000     (레포 최상위에서)
문서:  http://localhost:8000/docs  (자동 생성되는 API 문서)

시각 규칙
- 요청의 시각은 '2026-11-09T23:30' 같은 서울 시각(ISO). 시간대를 안 붙이면 +09:00으로 본다
- 03시 이전 시각은 전날 운행일로 계산한다 (00:30 → 전날 운행일의 24:30)
- 응답의 시각도 ISO(+09:00)로 준다
"""
import datetime as dt
import json
import os
import secrets
import sqlite3
import sys
import threading
from typing import List, Optional  # noqa: F401
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import deadline as deadline_mod  # noqa: E402
import groups as groups_mod  # noqa: E402
import network  # noqa: E402
import raptor  # noqa: E402

with open(os.path.join(ROOT, "config", "app.json"), encoding="utf-8") as f:
    APP_CFG = json.load(f)
HOLIDAYS = set(APP_CFG["holidays"])
KST = dt.timezone(dt.timedelta(hours=9))
DB_PATH = os.path.join(ROOT, "server", "data", "mova.db")

app = FastAPI(title=APP_CFG["service_name"] + " API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------- 시각 변환 ----------

def service_day(when: dt.datetime):
    """실제 시각 → (운행일 날짜, 운행일 기준 초, 요일 유형)."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=KST)
    when = when.astimezone(KST)
    day = when.date()
    sec = when.hour * 3600 + when.minute * 60 + when.second
    if when.hour < 3:
        day -= dt.timedelta(days=1)
        sec += 86400
    if day.isoformat() in HOLIDAYS or day.weekday() == 6:
        dtype = "HOL"
    elif day.weekday() == 5:
        dtype = "SAT"
    else:
        dtype = "WD"
    return day, sec, dtype


def to_iso(day: dt.date, sec: int) -> str:
    t = dt.datetime.combine(day, dt.time(0), tzinfo=KST) + dt.timedelta(seconds=int(sec))
    return t.isoformat(timespec="seconds")


# ---------- 노선망 (요일 유형마다 한 번 읽어 메모리에 둔다) ----------

_nets = {}
_net_lock = threading.Lock()


def get_net(dtype):
    with _net_lock:
        if dtype not in _nets:
            _nets[dtype] = network.load(dtype)
        return _nets[dtype]


# ---------- 요청·응답 모양 ----------

class Point(BaseModel):
    lat: float = Field(..., ge=37.4, le=37.72, description="위도 (1차 범위: 서울)")
    lng: float = Field(..., ge=126.75, le=127.2, description="경도")
    label: Optional[str] = Field(None, description="화면 표시용 이름 (예: 집, 강남역)")


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    departure_time: dt.datetime = Field(..., description="출발 시각, 예: 2026-11-09T23:30")


class DeadlineRequest(BaseModel):
    origin: Point
    destination: Point
    from_time: dt.datetime = Field(..., description="이 시각 이후로 출발 마감을 찾는다, 예: 2026-11-09T21:00")


class GroupCreate(BaseModel):
    name: str = Field(..., max_length=40)
    meeting_place: Point
    date: dt.date = Field(..., description="모임 날짜 (운행일). 예: 2026-12-18")


class MemberCreate(BaseModel):
    nickname: str = Field(..., max_length=20)
    home: Point
    toss_id: Optional[str] = Field(None, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$",
                                   description="토스 아이디 (toss.me/아이디). 택시비를 낸 사람에게 송금 링크를 만든다")


def leg_json(leg, day):
    out = {"type": leg["type"], "from": leg["from"], "to": leg["to"]}
    if leg["type"] == "walk":
        out["duration_sec"] = leg["sec"]
    elif leg["type"] == "taxi":
        out.update({"departure": to_iso(day, leg["dep"]), "arrival": to_iso(day, leg["arr"]),
                    "wait_sec": leg["wait_sec"], "drive_sec": leg["drive_sec"], "distance_m": leg["dist_m"],
                    "fare": leg["fare"], "fare_range": list(leg["fare_range"]), "estimated": True})
    else:
        out["type"] = "subway" if leg["type"] == "rail" else "bus"
        out.update({"line": leg["line"],
                    "trip": leg["trip"], "departure": to_iso(day, leg["dep"]), "arrival": to_iso(day, leg["arr"]),
                    "stops": leg["stops"]})
        if leg["type"] == "bus":
            out["headway_min"] = leg["headway_min"]
        if "dist_m" in leg:
            out["distance_m"] = leg["dist_m"]
    return out


def option_json(kind, r, day, t0):
    return {"kind": kind, "arrival": to_iso(day, r["arrive"]), "duration_min": (r["arrive"] - t0) // 60,
            "fare": r["fare"], "rides": r.get("legs_count", 0),
            "fare_detail": {"transit": r.get("transit_fare", r["fare"] if kind == "transit" else 0),
                            "taxi": r.get("taxi_fare", 0)},
            "recommended": r.get("recommended", False),
            "combo_kind": r.get("combo_kind"),
            "legs": [leg_json(l, day) for l in r["legs"]]}


# ---------- API ----------

@app.get("/api/health")
def health():
    return {"ok": True, "loaded_networks": sorted(_nets)}


@app.get("/api/config")
def config():
    return {"service_name": APP_CFG["service_name"], "region": APP_CFG["region"]}


@app.post("/api/routes")
def routes(req: RouteRequest):
    """F1·F2: 택시 직행 / 대중교통만 / 대중교통 + 택시 조합."""
    day, t0, dtype = service_day(req.departure_time)
    net = get_net(dtype)
    p = raptor.plan(net, (req.origin.lat, req.origin.lng), (req.destination.lat, req.destination.lng), t0)
    d = p["taxi_direct"]
    options = [{"kind": "taxi", "arrival": to_iso(day, d["arrive"]), "duration_min": (d["arrive"] - t0) // 60,
                "fare": d["fare"], "rides": 0, "fare_detail": {"transit": 0, "taxi": d["fare"]},
                "fare_range": list(d["fare_range"]), "recommended": False,
                "legs": [{"type": "taxi", "from": req.origin.label or "출발지", "to": req.destination.label or "도착지",
                          "departure": to_iso(day, t0 + d["wait_sec"]), "arrival": to_iso(day, d["arrive"]),
                          "wait_sec": d["wait_sec"], "drive_sec": d["drive_sec"], "distance_m": d["dist_m"],
                          "fare": d["fare"], "fare_range": list(d["fare_range"]), "estimated": True}]}]
    options += [option_json("transit", r, day, t0) for r in p["transit"]]
    options += [option_json("combo", c, day, t0) for c in p["combo"]]
    return {"service_day": day.isoformat(), "day_type": dtype, "departure": to_iso(day, t0),
            "options": options,
            "notes": ["택시 거리·시간·요금은 직선거리 기반 추정입니다",
                      "버스는 막차·첫차만 공식 시각이고 그 사이는 배차 간격 기반 추정입니다"]}


def deadline_json(d, day):
    out = {}
    for key in ("regular", "night"):
        v = d[key]
        if v is None:
            out[key] = None
            continue
        out[key] = {"leave_by": to_iso(day, v["leave_by"]), "latest": to_iso(day, v["latest"]),
                    "all_night": bool(v.get("all_night", False)),
                    "route": option_json("transit", {**v["route"], "fare": raptor.fares.transit_fare(v["route"]["legs"])},
                                         day, v["latest"])}
    return out


@app.post("/api/deadline")
def deadline(req: DeadlineRequest):
    """F3: 몇 시까지 출발하면 대중교통으로 갈 수 있나. regular = 지하철·일반버스, night = 심야버스 포함."""
    day, t0, dtype = service_day(req.from_time)
    net = get_net(dtype)
    d = deadline_mod.deadlines(net, (req.origin.lat, req.origin.lng), (req.destination.lat, req.destination.lng), t0)
    return {"service_day": day.isoformat(), "day_type": dtype, "from": to_iso(day, t0),
            "buffer_min": deadline_mod.BUFFER_MIN, **deadline_json(d, day)}


# ---------- 모임 (F3) ----------

def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("""create table if not exists groups (
        id text primary key, name text, meet_lat real, meet_lng real, meet_label text,
        date text, created_at text)""")
    con.execute("""create table if not exists members (
        id text primary key, group_id text, nickname text, home_lat real, home_lng real,
        home_label text, created_at text)""")
    cols = {r[1] for r in con.execute("pragma table_info(members)")}
    if "toss_id" not in cols:
        con.execute("alter table members add column toss_id text")
    return con


def now_iso():
    return dt.datetime.now(KST).isoformat(timespec="seconds")


@app.post("/api/groups")
def create_group(req: GroupCreate):
    gid = secrets.token_urlsafe(6)
    with db() as con:
        con.execute("insert into groups values (?,?,?,?,?,?,?)",
                    (gid, req.name, req.meeting_place.lat, req.meeting_place.lng, req.meeting_place.label,
                     req.date.isoformat(), now_iso()))
    return {"id": gid, "share_path": f"/g/{gid}"}


@app.post("/api/groups/{gid}/members")
def add_member(gid: str, req: MemberCreate):
    mid = secrets.token_urlsafe(6)
    with db() as con:
        if not con.execute("select 1 from groups where id=?", (gid,)).fetchone():
            raise HTTPException(404, "모임이 없습니다")
        con.execute("insert into members (id, group_id, nickname, home_lat, home_lng, home_label, created_at, toss_id) "
                    "values (?,?,?,?,?,?,?,?)",
                    (mid, gid, req.nickname, req.home.lat, req.home.lng, req.home.label, now_iso(), req.toss_id))
    return {"id": mid}


_deadline_cache = {}


def toss_link(toss_id, amount):
    return f"https://toss.me/{quote(toss_id)}/{int(amount)}" if toss_id else None


def taxi_groups_json(g, members, deadlines, leave_at):
    """leave_at에 지하철·일반버스 막차가 끊긴 사람끼리 택시를 묶고 정산한다."""
    day, t_leave, _ = service_day(leave_at)
    need = [m for m in members
            if deadlines[m["id"]]["regular"] is None
            or deadlines[m["id"]]["regular"]["leave_by"] < to_iso(day, t_leave)]
    if not need:
        return [], []
    taxis = groups_mod.plan_taxis((g["meet_lat"], g["meet_lng"]),
                                  [(m["home_lat"], m["home_lng"]) for m in need], t_leave)
    out, transfers = [], []
    for x in taxis:
        payer = need[x["payer"]]
        riders = []
        for st in x["stops"]:
            m = need[st["member"]]
            share = x["shares"][st["member"]]
            riders.append({"member_id": m["id"], "nickname": m["nickname"], "arrival": to_iso(day, st["arrive"]),
                           "meter_at_dropoff": st["meter"], "share": share,
                           "solo_fare": x["solo_fares"][st["member"]],
                           "saving": x["solo_fares"][st["member"]] - share})
            if m["id"] != payer["id"]:
                transfers.append({"from_member_id": m["id"], "from": m["nickname"],
                                  "to_member_id": payer["id"], "to": payer["nickname"], "amount": share,
                                  "toss_link": toss_link(payer["toss_id"], share)})
        out.append({"riders": riders, "total_fare": x["total_fare"], "payer_member_id": payer["id"],
                    "payer": payer["nickname"], "estimated": True})
    return out, transfers


@app.get("/api/groups/{gid}")
def get_group(gid: str, leave_at: Optional[dt.datetime] = None):
    """모임 정보 + 사람별 출발 마감 (모임 장소 → 각자 집).
    leave_at(모임이 끝나는 시각)을 주면, 그때 지하철·일반버스 막차가 끊긴 사람끼리 택시를 묶고 정산한다."""
    with db() as con:
        g = con.execute("select * from groups where id=?", (gid,)).fetchone()
        if not g:
            raise HTTPException(404, "모임이 없습니다")
        members = con.execute("select * from members where group_id=? order by created_at", (gid,)).fetchall()
    h, m = map(int, APP_CFG["group_deadline_from"].split(":"))
    start = dt.datetime.combine(dt.date.fromisoformat(g["date"]), dt.time(h, m), tzinfo=KST)
    day, t0, dtype = service_day(start)
    net = get_net(dtype)
    out, dls = [], {}
    for mb in members:
        key = (g["id"], mb["id"], dtype, id(net))
        if key not in _deadline_cache:
            d = deadline_mod.deadlines(net, (g["meet_lat"], g["meet_lng"]), (mb["home_lat"], mb["home_lng"]), t0)
            _deadline_cache[key] = deadline_json(d, day)
        dls[mb["id"]] = _deadline_cache[key]
        out.append({"id": mb["id"], "nickname": mb["nickname"],
                    "home": {"lat": mb["home_lat"], "lng": mb["home_lng"], "label": mb["home_label"]},
                    "deadline": _deadline_cache[key]})
    out.sort(key=lambda x: (x["deadline"]["regular"] or {}).get("leave_by") or "9999")
    taxi_groups = transfers = None
    if leave_at is not None:
        taxi_groups, transfers = taxi_groups_json(g, members, dls, leave_at)
    return {"id": g["id"], "name": g["name"], "date": g["date"], "day_type": dtype,
            "meeting_place": {"lat": g["meet_lat"], "lng": g["meet_lng"], "label": g["meet_label"]},
            "members": out, "leave_at": leave_at.isoformat() if leave_at else None,
            "taxi_groups": taxi_groups, "settlement": transfers,
            "notes": ["leave_at을 주면 그때 막차(지하철·일반버스)가 끊긴 사람끼리 택시를 묶습니다",
                      "택시 요금은 직선거리 기반 추정이고, 정산은 내리는 곳 기준(구간 요금을 그 구간 탑승자끼리 나눔)입니다"]}

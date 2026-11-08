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

import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import deadline as deadline_mod  # noqa: E402
import naver  # noqa: E402
import groups as groups_mod  # noqa: E402
import network  # noqa: E402
import raptor  # noqa: E402
import realtime  # noqa: E402

with open(os.path.join(ROOT, "config", "app.json"), encoding="utf-8") as f:
    APP_CFG = json.load(f)
HOLIDAYS = set(APP_CFG["holidays"])
KST = dt.timezone(dt.timedelta(hours=9))
DB_PATH = os.path.join(ROOT, "server", "data", "mova.db")

app = FastAPI(title=APP_CFG["service_name"] + " API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=APP_CFG.get("cors_origins", []),
                   allow_origin_regex=APP_CFG.get("cors_origin_regex"), allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])

# ---------- 요청 제한 (IP별, 메모리) ----------
# 무거운 요청(경로·마감·모임 조회)은 엔진과 네이버 호출을 쓰므로 더 세게 막는다
HEAVY = {"/api/routes", "/api/deadline"}
LIMITS = APP_CFG.get("rate_limits", {"heavy": [20, 300], "light": [60, 3000]})
_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def client_ip(request: Request) -> str:
    # Caddy가 앞에 있으므로 X-Forwarded-For의 첫 주소가 실제 사용자
    xff = request.headers.get("x-forwarded-for")
    return xff.split(",")[0].strip() if xff else (request.client.host if request.client else "?")


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or path in ("/api/health", "/api/config") or request.method == "OPTIONS":
        return await call_next(request)
    heavy = path in HEAVY or (path.startswith("/api/groups/") and request.method == "GET")
    per_min, per_day = LIMITS["heavy" if heavy else "light"]
    key = (client_ip(request), "heavy" if heavy else "light")
    now = time.time()
    with _hits_lock:
        q = _hits[key]
        while q and now - q[0] > 86400:
            q.popleft()
        last_min = sum(1 for t in q if now - t <= 60)
        if last_min >= per_min or len(q) >= per_day:
            wait = 60 if last_min >= per_min else int(86400 - (now - q[0]))
            return JSONResponse({"detail": "요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.", "retry_after_sec": wait},
                                status_code=429, headers={"Retry-After": str(wait)})
        q.append(now)
    return await call_next(request)


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


def is_live(when: dt.datetime) -> bool:
    """출발 시각이 지금부터 20분 안이면 네이버 실시간 소요 시간을 쓴다."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=KST)
    return abs((when - dt.datetime.now(KST)).total_seconds()) <= 20 * 60


def to_iso(day: dt.date, sec: int) -> str:
    t = dt.datetime.combine(day, dt.time(0), tzinfo=KST) + dt.timedelta(seconds=int(sec))
    return t.isoformat(timespec="seconds")


# ---------- 노선망 (요일 유형마다 한 번 읽어 메모리에 둔다) ----------

_nets = {}
_net_lock = threading.Lock()


def _official_mtime(dtype):
    f = network.official_file(dtype)
    return os.path.getmtime(f) if f else 0


def get_net(dtype):
    """요일 유형별 노선망. 공식 버스 시각 파일이 새로 생기면(정기 수집) 다시 읽는다."""
    with _net_lock:
        cur = _nets.get(dtype)
        if cur is None or cur[1] < _official_mtime(dtype):
            _nets[dtype] = (network.load(dtype), _official_mtime(dtype))
        return _nets[dtype][0]


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


def leg_json(leg, day):
    out = {"type": leg["type"], "from": leg["from"], "to": leg["to"]}
    if leg["type"] == "walk":
        out["duration_sec"] = leg["sec"]
    elif leg["type"] == "taxi":
        out.update({"departure": to_iso(day, leg["dep"]), "arrival": to_iso(day, leg["arr"]),
                    "wait_sec": leg["wait_sec"], "drive_sec": leg["drive_sec"], "distance_m": leg["dist_m"],
                    "fare": leg["fare"], "fare_range": list(leg["fare_range"]),
                    "source": leg.get("source", "estimate"), "estimated": leg.get("source", "estimate") == "estimate"})
    else:
        out["type"] = "subway" if leg["type"] == "rail" else "bus"
        out.update({"line": leg["line"],
                    "trip": leg["trip"], "departure": to_iso(day, leg["dep"]), "arrival": to_iso(day, leg["arr"]),
                    "stops": leg["stops"]})
        if leg["type"] == "bus":
            out["headway_min"] = leg["headway_min"]
        if leg.get("realtime"):
            rt = dict(leg["realtime"])
            if "realtime_dep" in rt:
                rt["realtime_dep"] = to_iso(day, rt["realtime_dep"])
            out["realtime"] = rt
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
    return {"ok": True, "loaded_networks": sorted(_nets),
            "naver_calls": {"today": naver.usage_today(), "month": naver.usage_this_month(),
                            "daily_limit": naver.DAILY_LIMIT, "monthly_limit": naver.MONTHLY_LIMIT}}


@app.get("/api/config")
def config():
    return {"service_name": APP_CFG["service_name"], "region": APP_CFG["region"]}


_stations = None


def stations():
    """역 이름 검색용 (place마다 하나, 좌표는 노선별 점의 평균)."""
    global _stations
    if _stations is None:
        import pandas as pd
        st = pd.read_csv(os.path.join(ROOT, "prep", "out", "stations.csv"), dtype={"place_id": str})
        st = st[~st.coord_suspect.astype(bool)]
        st = st.groupby("place_id").agg(name=("name", "first"), lat=("lat", "mean"), lng=("lng", "mean"),
                                        lines=("line", lambda x: sorted(set(x)))).reset_index()
        st["key"] = st.name.str.replace(r"\(.*\)", "", regex=True).str.replace("역", "").str.strip()
        _stations = st
    return _stations


SEOUL_BOX = (37.4, 37.72, 126.75, 127.2)


def in_seoul(lat, lng):
    return SEOUL_BOX[0] <= lat <= SEOUL_BOX[1] and SEOUL_BOX[2] <= lng <= SEOUL_BOX[3]


@app.get("/api/geocode")
def geocode(q: str):
    """검색어 → 후보. 역 이름은 우리 역 목록, 주소는 네이버 Geocoding, 가게·장소 이름은 네이버 지역 검색. 서울 범위만."""
    q = q.strip()
    if not q:
        return {"query": q, "results": []}
    out = []
    key = q.replace("역", "").strip()
    st = stations()
    m = st[st.key == key]
    exact_station = not m.empty
    if m.empty and len(key) >= 2:
        m = st[st.key.str.startswith(key)].head(5)
    for r in m.itertuples():
        if in_seoul(r.lat, r.lng):
            out.append({"kind": "station", "label": f"{r.name}역" if not r.name.endswith("역") else r.name,
                        "address": ", ".join(l.replace("서울 도시철도 ", "") for l in r.lines),
                        "lat": round(r.lat, 6), "lng": round(r.lng, 6)})
    addresses = [a for a in naver.geocode(q) if in_seoul(a["lat"], a["lng"])]
    # 주소로 딱 맞으면 가게 검색은 건너뛴다 (호출 절약). 아니면 가게·장소 이름으로 찾는다
    if not addresses and not exact_station:
        for p in naver.local_search(q):
            if in_seoul(p["lat"], p["lng"]):
                out.append({"kind": "place", "label": p["name"], "address": p["address"],
                            "category": p["category"], "lat": round(p["lat"], 6), "lng": round(p["lng"], 6)})
    for a in addresses:
        out.append({"kind": "address", "label": a["address"], "address": a["jibun"],
                    "lat": a["lat"], "lng": a["lng"]})
    return {"query": q, "results": out[:10],
            "notes": [] if out else ["역 이름, 가게·장소 이름, 도로명·지번 주소로 검색해 주세요 (서울 안만)"]}


@app.get("/api/reverse")
def reverse(lat: float, lng: float):
    """좌표 → 표시 이름 (예: 노원구 상계동)."""
    r = naver.reverse(lat, lng)
    if r is None:
        return {"label": None}
    return {"label": f"{r['gu']} {r['dong']}", **r}


@app.post("/api/routes")
def routes(req: RouteRequest):
    """F1·F2: 택시 직행 / 대중교통만 / 대중교통 + 택시 조합."""
    day, t0, dtype = service_day(req.departure_time)
    net = get_net(dtype)
    live = is_live(req.departure_time)
    p = raptor.plan(net, (req.origin.lat, req.origin.lng), (req.destination.lat, req.destination.lng), t0, live=live)
    if live:
        # 첫 버스 실시간: 지금 시각을 운행일 기준 초로
        _, now_sec, _ = service_day(dt.datetime.now(KST))
        realtime.annotate_plan(p, now_sec)
    d = p["taxi_direct"]
    options = [{"kind": "taxi", "arrival": to_iso(day, d["arrive"]), "duration_min": (d["arrive"] - t0) // 60,
                "fare": d["fare"], "rides": 0, "fare_detail": {"transit": 0, "taxi": d["fare"]},
                "fare_range": list(d["fare_range"]), "recommended": False,
                "legs": [{"type": "taxi", "from": req.origin.label or "출발지", "to": req.destination.label or "도착지",
                          "departure": to_iso(day, t0 + d["wait_sec"]), "arrival": to_iso(day, d["arrive"]),
                          "wait_sec": d["wait_sec"], "drive_sec": d["drive_sec"], "distance_m": d["dist_m"],
                          "fare": d["fare"], "fare_range": list(d["fare_range"]),
                          "source": d.get("source", "estimate"), "estimated": d.get("source", "estimate") == "estimate"}]}]
    options += [option_json("transit", r, day, t0) for r in p["transit"]]
    options += [option_json("combo", c, day, t0) for c in p["combo"]]
    return {"service_day": day.isoformat(), "day_type": dtype, "departure": to_iso(day, t0), "live": live,
            "options": options,
            "notes": ["택시 구간의 source: naver_live(네이버 실시간 경로), naver(네이버 경로 거리 + 심야 속도), estimate(직선거리 추정)",
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


# ---------- 실제 금액 나누기 (F3) ----------

class SettleRider(BaseModel):
    nickname: str = Field(..., max_length=20)
    member_id: Optional[str] = None
    estimated_meter: Optional[int] = Field(None, ge=0, description="예상 미터기 (GET /api/groups의 estimated_meters)")
    actual_meter: Optional[int] = Field(None, ge=0, description="내릴 때 본 실제 미터기 금액 (선택)")


class SettleRequest(BaseModel):
    riders: List[SettleRider] = Field(..., min_length=1, max_length=4, description="내린 순서대로. 마지막 사람이 낸 사람")
    total_fare: int = Field(..., gt=0, le=500000, description="실제로 낸 택시비 총액")


@app.post("/api/settle")
def settle(req: SettleRequest):
    """내린 뒤 실제 금액으로 나누기. 각자 내릴 때 미터기 금액을 넣으면 그대로 구간을 나누고,
    총액만 넣으면 예상 미터기 비율대로 나눈다 (예상도 없으면 똑같이 나눔). 송금은 하지 않는다."""
    n = len(req.riders)
    est = [r.estimated_meter for r in req.riders]
    if any(e is None for e in est):
        est = [req.total_fare * (i + 1) / n for i in range(n)]      # 예상이 없으면 구간을 똑같이
    actual = [r.actual_meter for r in req.riders]
    use_actual = all(a is not None for a in actual)
    shares, payer = groups_mod.settle_actual(est, req.total_fare, actual if use_actual else None)
    p = req.riders[payer]
    return {"total_fare": req.total_fare, "method": "actual_meters" if use_actual else "estimated_ratio",
            "payer": p.nickname,
            "shares": [{"nickname": r.nickname, "member_id": r.member_id, "share": sh}
                       for r, sh in zip(req.riders, shares)],
            "transfers": [{"from": r.nickname, "to": p.nickname, "amount": sh}
                          for i, (r, sh) in enumerate(zip(req.riders, shares)) if i != payer]}


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
        con.execute("insert into members (id, group_id, nickname, home_lat, home_lng, home_label, created_at) "
                    "values (?,?,?,?,?,?,?)",
                    (mid, gid, req.nickname, req.home.lat, req.home.lng, req.home.label, now_iso()))
    return {"id": mid}


_deadline_cache = {}


def taxi_groups_json(g, members, deadlines, leave_at):
    """leave_at에 지하철·일반버스 막차가 끊긴 사람끼리 택시를 묶고 정산한다."""
    day, t_leave, _ = service_day(leave_at)
    need = [m for m in members
            if deadlines[m["id"]]["regular"] is None
            or deadlines[m["id"]]["regular"]["leave_by"] < to_iso(day, t_leave)]
    if not need:
        return [], []
    taxis = groups_mod.plan_taxis((g["meet_lat"], g["meet_lng"]),
                                  [(m["home_lat"], m["home_lng"]) for m in need], t_leave, live=is_live(leave_at))
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
                                  "estimated": True})
        out.append({"riders": riders, "total_fare": x["total_fare"],
                    "estimated_meters": [st["meter"] for st in x["stops"]], "payer_member_id": payer["id"],
                    "payer": payer["nickname"], "source": x.get("source", "estimate"),
                    "estimated": x.get("source", "estimate") == "estimate"})
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
                      "택시 요금과 settlement는 예상값입니다. 내린 뒤 실제 금액은 POST /api/settle로 다시 나눕니다 (송금은 각자)",
                      "택시 요금은 네이버 실제 경로(경유지 포함) 기준이고(키가 없거나 한도를 넘으면 추정), 정산은 내리는 곳 기준입니다",
                      "solo_fare(혼자 탔을 때)는 추정값이라 saving은 참고용입니다"]}

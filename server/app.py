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
import hashlib
import secrets
import sqlite3
import sys
import threading
import re
from typing import List, Optional, Union  # noqa: F401

import time

import numpy as np
from collections import defaultdict, deque

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

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
                   allow_origin_regex=APP_CFG.get("cors_origin_regex"), allow_methods=["GET", "POST", "PATCH", "DELETE"],
                   allow_headers=["Content-Type", "Authorization"])

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
    return day, sec, day_type_of(day)


OVERLAP_HOURS = range(3, 6)     # 03~05시: 전날 밤(심야버스 04시 반까지)과 새 날(첫 버스 04시대, 첫차 05시대)이 겹친다


def service_day_candidates(when: dt.datetime):
    """03~05시 출발은 전날 운행일(심야버스)과 새 운행일(첫차) 둘 다 본다 → [(운행일, 초, 요일 유형)]."""
    day, sec, dtype = service_day(when)
    out = [(day, sec, dtype)]
    if when.astimezone(KST).hour in OVERLAP_HOURS:
        prev = day - dt.timedelta(days=1)
        out.insert(0, (prev, sec + 86400, day_type_of(prev)))
    return out


def day_type_of(day):
    if day.isoformat() in HOLIDAYS or day.weekday() == 6:
        return "HOL"
    return "SAT" if day.weekday() == 5 else "WD"


def is_live(when: dt.datetime) -> bool:
    """출발 시각이 지금부터 20분 안이면 네이버 실시간 소요 시간을 쓴다."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=KST)
    return abs((when - dt.datetime.now(KST)).total_seconds()) <= 20 * 60


PAST_GRACE = dt.timedelta(minutes=30)


def resolve_time(value, now=None) -> dt.datetime:
    """출발 시각 입력 → 실제 시각(KST).
    - 날짜까지 있는 시각(2026-11-16T23:40)은 그대로
    - "now" 또는 빈 값은 지금
    - "23:40"처럼 시:분만 오면 '오늘 밤' 기준: 03시 전(00:30 등)은 다음 날 새벽.
      그렇게 정한 시각이 지금보다 30분 넘게 지났으면 다음 날 밤으로 본다
      (예: 화 00:10에 "23:40"을 고르면 화 23:40)"""
    now = (now or dt.datetime.now(KST)).astimezone(KST)
    if value is None or isinstance(value, dt.datetime):
        if value is None:
            return now
        return value if value.tzinfo else value.replace(tzinfo=KST)
    v = str(value).strip().lower()
    if v in ("", "now"):
        return now
    if "t" in v or "-" in v:                       # 날짜까지 있는 시각이 문자열로 온 경우
        try:
            return resolve_time(dt.datetime.fromisoformat(str(value).strip().replace("Z", "+00:00")), now)
        except ValueError:
            raise ValueError('시각은 "now", "23:40" 같은 시:분, 또는 2026-11-16T23:40 형식이에요')
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", v)
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ValueError('시각은 "now", "23:40" 같은 시:분, 또는 2026-11-16T23:40 형식이에요')
    h, mi = int(m.group(1)), int(m.group(2))
    base = now.date() if now.hour >= 3 else now.date() - dt.timedelta(days=1)    # 지금의 운행일
    t = dt.datetime.combine(base, dt.time(h, mi), tzinfo=KST)
    if h < 3:
        t += dt.timedelta(days=1)
    if t < now - PAST_GRACE:
        t += dt.timedelta(days=1)
    return t


def to_iso(day: dt.date, sec: int) -> str:
    t = dt.datetime.combine(day, dt.time(0), tzinfo=KST) + dt.timedelta(seconds=int(sec))
    return t.isoformat(timespec="seconds")


# ---------- 노선망 (요일 유형마다 한 번 읽어 메모리에 둔다) ----------

_nets = {}
_net_lock = threading.Lock()


def _official_mtime(dtype):
    return network.data_mtime(dtype)       # 공식 버스 시각 + 심야버스 실측


def get_net(dtype):
    """요일 유형별 노선망. 공식 버스 시각·심야버스 실측 파일이 새로 생기면 다시 읽는다."""
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
    departure_time: Optional[Union[dt.datetime, str]] = Field(
        None, validate_default=True, description='출발 시각: "now"(또는 생략) / "23:40" (오늘 밤 기준, 03시 전은 다음 날 새벽) / 2026-11-09T23:30')

    @field_validator("departure_time", mode="after")
    @classmethod
    def _resolve(cls, v):
        return resolve_time(v)


class DeadlineRequest(BaseModel):
    origin: Point
    destination: Point
    from_time: Optional[Union[dt.datetime, str]] = Field(
        None, validate_default=True, description='이 시각 이후로 출발 마감을 찾는다: "now"(또는 생략) / "21:00" / 2026-11-09T21:00')

    @field_validator("from_time", mode="after")
    @classmethod
    def _resolve(cls, v):
        return resolve_time(v)


class GroupCreate(BaseModel):
    name: str = Field("", max_length=40, description="모임 이름 (선택)")
    meeting_place: Point
    departure_time: Optional[Union[dt.datetime, str]] = Field(
        None, description='출발 예정 시각: "now"(또는 생략) / "23:40" / 2026-12-18T23:40. 이 시각부터 마감을 찾는다')
    date: Optional[dt.date] = Field(None, description="(예전 방식) 모임 날짜만 주면 그날 21:00부터 찾는다")


class MemberCreate(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=20)
    home: Point


class MemberUpdate(BaseModel):
    nickname: Optional[str] = Field(None, min_length=1, max_length=20)
    home: Optional[Point] = None


class Feedback(BaseModel):
    """F2-09·F2-10: 도착 후 실제 택시비. 주소 없이 보관한다."""
    search_id: Optional[str] = Field(None, max_length=64)
    option_id: Optional[str] = Field(None, max_length=32)
    option_kind: Optional[str] = Field(None, max_length=16, description="taxi / transit / combo")
    fare_range: Optional[List[int]] = Field(None, min_length=2, max_length=2, description="그 안의 예상 요금 범위")
    actual_fare: Optional[int] = Field(None, ge=0, le=500000, description="실제 택시비 (건너뛰면 비움)")
    skipped: bool = False
    distance_m: Optional[int] = Field(None, ge=0, description="택시 구간 거리 (거리대 보정용)")
    departure: Optional[str] = Field(None, max_length=40, description="출발 시각 (시간대 보정용)")


class Event(BaseModel):
    device_id: str = Field(..., min_length=4, max_length=64, description="익명 기기 ID (브라우저에서 만든 임의 값)")
    name: str = Field(..., min_length=1, max_length=40, description="이벤트 이름 (예: search, select_option, share)")
    area: Optional[str] = Field(None, max_length=40, description="동 이름까지만 (주소 금지)")
    option_kind: Optional[str] = Field(None, max_length=16)


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
        out["is_last"] = bool(leg.get("is_last", False))          # 시간표 기준 그 정류장 막차
        if leg["type"] == "bus":
            out["headway_min"] = leg["headway_min"]
            out["night"] = str(leg["line"]).startswith("N")           # 심야버스
            out["timetable"] = "observed" if "(실측)" in str(leg["trip"]) else "estimate"
        else:
            out["night"] = False
            out["timetable"] = "official"
        if leg.get("realtime"):
            rt = dict(leg["realtime"])
            if "realtime_dep" in rt:
                rt["realtime_dep"] = to_iso(day, rt["realtime_dep"])
            out["realtime"] = rt
        if "dist_m" in leg:
            out["distance_m"] = leg["dist_m"]
    return out


TIGHT_TRANSFER_SEC = 180      # 갈아탈 여유가 이 이하면 경고 (F1-13)


def _mid(rng):
    return (rng[0] + rng[1]) / 2


def option_fare_range(kind, r):
    """카드 요금 범위: 대중교통 요금(고정) + 택시 구간 범위 합."""
    if kind == "taxi":
        return list(r["fare_range"])
    lo = hi = r.get("transit_fare", r["fare"] if kind == "transit" else 0)
    for l in r["legs"]:
        if l["type"] == "taxi":
            lo, hi = lo + l["fare_range"][0], hi + l["fare_range"][1]
    return [int(lo), int(hi)]


def option_warnings(r, dest):
    """F1-13 환승 여유 경고(놓치면 그 자리에서 택시 타는 요금), 버스 추정·택시 교통 정보 없음."""
    out = []
    ready, prev = None, None
    for l in r["legs"]:
        if l["type"] == "walk":
            if ready is not None:
                ready += l["sec"]
            continue
        if l["type"] in ("rail", "bus") and prev is not None and prev["type"] in ("rail", "bus") and ready is not None:
            slack = l["dep"] - ready
            if slack <= TIGHT_TRANSFER_SEC and prev.get("to_ll"):
                straight = float(np.linalg.norm(raptor.to_xy([prev["to_ll"][0]], [prev["to_ll"][1]])[0]
                                                - raptor.to_xy([dest[0]], [dest[1]])[0]))
                t = raptor.fares.taxi_trip(np.array([straight]), np.array([ready]))
                out.append({"code": "TIGHT_TRANSFER", "at": l["from"], "slack_sec": int(max(slack, 0)),
                            "message": f"{l['from']}에서 갈아탈 여유가 {max(slack, 0) // 60}분 {max(slack, 0) % 60}초예요",
                            "fallback_taxi": {"from": prev["to"], "fare": int(t["fare"][0]),
                                              "fare_range": [int(t["fare_lo"][0]), int(t["fare_hi"][0])]}})
        ready, prev = l["arr"], l
    if any(l["type"] == "bus" and "(실측)" not in str(l.get("trip")) for l in r["legs"]):
        out.append({"code": "BUS_ESTIMATE", "message": "버스 시각 일부는 첫차·막차와 배차 간격으로 추정했어요"})
    if any(l["type"] == "taxi" and l.get("source", "estimate") == "estimate" for l in r["legs"]):
        out.append({"code": "NO_TRAFFIC", "message": "택시 구간은 교통 정보 없이 계산했어요"})
    return out


def pick_recommended(options):
    """F1-11: 택시 직행보다 recommend_max_delay_min분 넘게 늦지 않는 안 중 가장 많이 아끼는 안, 없으면 가장 싼 안.
    조합(F1-10)은 최대 2안: 추천이 조합이면 그것 + 다른 하나, 아니면 앞의 둘."""
    limit = raptor.fares.CFG["choice"].get("recommend_max_delay_min", 15)
    cards = [o for o in options if o["kind"] != "taxi" and o["available"]]
    for o in options:
        o["recommended"] = False
    if not cards:
        return
    near = [o for o in cards if o["delay_vs_taxi_min"] <= limit]
    best = (max(near, key=lambda o: (o["saving_vs_taxi"], -o["delay_vs_taxi_min"])) if near
            else min(cards, key=lambda o: (_mid(o["fare_range"]), o["delay_vs_taxi_min"])))
    best["recommended"] = True
    combos = [o for o in options if o["kind"] == "combo"]
    keep = ([best] if best["kind"] == "combo" else []) + [o for o in combos if o is not best]
    for o in combos[:]:
        if o not in keep[:2]:
            options.remove(o)


def compare_to_taxi(card, taxi_card):
    """F2-02·F2-07: 택시 직행 대비 절약액(요금 범위 가운데 값끼리)과 늦어지는 시간."""
    card["saving_vs_taxi"] = int(round(_mid(taxi_card["fare_range"]) - _mid(card["fare_range"])))
    late = (dt.datetime.fromisoformat(card["arrival"]) - dt.datetime.fromisoformat(taxi_card["arrival"])).total_seconds()
    card["delay_vs_taxi_min"] = int(np.ceil(late / 60))
    return card


def option_json(kind, r, day, t0, dest=None):
    return {"kind": kind, "available": True,
            "fare_range": option_fare_range(kind, r),
            "warnings": option_warnings(r, dest) if dest is not None else [], "arrival": to_iso(day, r["arrive"]), "duration_min": (r["arrive"] - t0) // 60,
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
SIDO_SHORT = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주",
              "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원",
              "강원도": "강원", "충청북도": "충북", "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북",
              "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주"}


def in_seoul(lat, lng):
    """좌표 대충 범위 (주소를 모를 때만 쓴다)."""
    return SEOUL_BOX[0] <= lat <= SEOUL_BOX[1] and SEOUL_BOX[2] <= lng <= SEOUL_BOX[3]


def region_of(address):
    """'서울특별시 강남구 강남대로 396' → '서울 강남구', '경기도 성남시 분당구 …' → '경기 성남시 분당구'. 모르면 None."""
    t = (address or "").split()
    if not t:
        return None
    sido = SIDO_SHORT.get(t[0], t[0] if t[0] in SIDO_SHORT.values() else None)
    if sido is None:
        return None
    parts = []
    for w in t[1:3]:
        if w.endswith(("시", "군", "구")):
            parts.append(w)
        else:
            break
    return " ".join([sido] + parts)


def _station_region(lat, lng):
    r = naver.reverse(lat, lng)
    if not r:
        return None
    return region_of(f"{r['si']} {r['gu']}")


def _with_region(item, address):
    """결과에 region(예: 서울 강남구)과 in_seoul을 붙인다. 주소를 모르면 좌표 범위로 서울인지 본다."""
    reg = region_of(address)
    item["region"] = reg
    item["in_seoul"] = reg.startswith("서울") if reg else in_seoul(item["lat"], item["lng"])
    return item


@app.get("/api/geocode")
def geocode(q: str):
    """검색어 → 후보. 역 이름은 우리 역 목록, 주소는 네이버 Geocoding, 가게·장소 이름은 네이버 지역 검색.
    결과마다 region(예: 서울 강남구)과 in_seoul. 서울 밖도 돌려주고(in_seoul=false) 서울 안을 앞에 둔다
    → 프론트가 서울 밖을 고르면 안내 화면(E1)으로 보낸다."""
    q = q.strip()
    if not q:
        return {"query": q, "results": [], "notes": []}
    out = []
    key = q.replace("역", "").strip()
    st = stations()
    m = st[st.key == key]
    exact_station = not m.empty
    if m.empty and len(key) >= 2:
        m = st[st.key.str.startswith(key)].head(5)
    for r in m.itertuples():
        item = {"kind": "station", "label": f"{r.name}역" if not r.name.endswith("역") else r.name,
                "address": ", ".join(l.replace("서울 도시철도 ", "") for l in r.lines),
                "lat": round(r.lat, 6), "lng": round(r.lng, 6)}
        sr = _station_region(r.lat, r.lng)
        out.append(_with_region(item, sr))
    addresses = naver.geocode(q)
    # 주소로 딱 맞으면 가게 검색은 건너뛴다 (호출 절약). 아니면 가게·장소 이름으로 찾는다
    if not addresses and not exact_station:
        for p in naver.local_search(q):
            out.append(_with_region({"kind": "place", "label": p["name"], "address": p["address"],
                                     "category": p["category"], "lat": round(p["lat"], 6), "lng": round(p["lng"], 6)},
                                    p["address"]))
    for a in addresses:
        out.append(_with_region({"kind": "address", "label": a["address"], "address": a["jibun"],
                                 "lat": a["lat"], "lng": a["lng"]}, a["address"]))
    out.sort(key=lambda x: not x["in_seoul"])          # 서울 안 먼저 (같은 쪽끼리는 원래 순서)
    notes = []
    if not out:
        notes.append("역 이름, 가게·장소 이름, 도로명·지번 주소로 검색해 주세요")
    elif not any(x["in_seoul"] for x in out):
        notes.append("서울 밖 장소만 찾았어요. 지금은 서울 안 출발·도착만 안내해요")
    return {"query": q, "results": out[:10], "notes": notes}


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
    live = is_live(req.departure_time)
    best = None
    for day, t0, dtype in service_day_candidates(req.departure_time):
        p = raptor.plan(get_net(dtype), (req.origin.lat, req.origin.lng), (req.destination.lat, req.destination.lng),
                        t0, live=live)
        arrivals = [r["arrive"] - t0 for r in p["transit"] + p["combo"]]
        score = min(arrivals) if arrivals else float("inf")         # 출발부터 걸리는 시간 (운행일이 달라도 비교 가능)
        if best is None or score < best[0]:
            best = (score, day, t0, dtype, p)
    _, day, t0, dtype, p = best
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
    dest = (req.destination.lat, req.destination.lng)
    options[0].update(option_id="taxi", available=True,
                      warnings=[] if d.get("source", "estimate") != "estimate"
                      else [{"code": "NO_TRAFFIC", "message": "택시는 교통 정보 없이 계산했어요"}])
    for i, r in enumerate(p["transit"], 1):
        options.append(dict(option_json("transit", r, day, t0, dest), option_id=f"transit-{i}"))
    for i, c in enumerate(p["combo"], 1):
        options.append(dict(option_json("combo", c, day, t0, dest), option_id=f"combo-{i}"))
    last = last_service(day, dtype, (req.origin.lat, req.origin.lng), dest, t0)
    if not p["transit"]:
        cut = last["regular_last_departure"]
        options.append({"kind": "transit", "option_id": "transit-none", "available": False,
                        "reason": "LAST_TRAIN_GONE",
                        "message": (f"대중교통 막차가 {cut[11:16]}에 끊겼어요" if cut else "지금은 대중교통으로 갈 수 없어요"),
                        "legs": []})
    for o in options[1:]:
        if o["available"]:
            compare_to_taxi(o, options[0])
    options[0].update(saving_vs_taxi=0, delay_vs_taxi_min=0)
    pick_recommended(options)
    return {"service_day": day.isoformat(), "day_type": dtype, "departure": to_iso(day, t0), "live": live,
            "options": options, "last_service": last, "data_as_of": data_as_of(dtype),
            "notes": ["택시 구간의 source: naver_live(네이버 실시간 경로), naver(네이버 경로 거리 + 심야 속도), estimate(직선거리 추정)",
                      "버스는 막차·첫차만 공식 시각이고 그 사이는 배차 간격 기반 추정입니다"]}


_last_cache = {}


def last_service(day, dtype, origin, dest, t0):
    """F2-03 막차 끊김: 지하철·일반버스(심야버스 빼고)로 갈 수 있는 가장 늦은 출발 시각.
    regular_cut = 지금 출발 시각에는 이미 끊김. 같은 장소·요일 유형은 메모리에 저장해 다시 쓴다."""
    net = get_net(dtype)
    key = (dtype, id(net), round(origin[0], 3), round(origin[1], 3), round(dest[0], 3), round(dest[1], 3))
    if key not in _last_cache:
        if len(_last_cache) > 2000:
            _last_cache.clear()
        t, _ = deadline_mod.latest_departure(net, origin, dest, 20 * 3600, skip=deadline_mod.night_routes(net))
        _last_cache[key] = t
    t = _last_cache[key]
    if t is None or t >= deadline_mod.SEARCH_END:
        return {"regular_last_departure": None, "regular_cut": False, "all_night": t is not None}
    return {"regular_last_departure": to_iso(day, t), "regular_cut": t < t0, "all_night": False}


def data_as_of(dtype):
    """데이터 기준일: 버스 공식 첫차·막차를 받은 날, 심야버스 실측 밤."""
    def date_of(name):
        m = re.search(r"_(\d{8})_", name or "")
        return f"{m.group(1)[:4]}-{m.group(1)[4:6]}-{m.group(1)[6:]}" if m else None
    net = get_net(dtype)
    nights = sorted({date_of(os.path.basename(f)) for f in network.night_files(dtype)} - {None})
    return {"bus_official": date_of(net.bus_official), "night_bus": nights[-1] if nights else None,
            "night_bus_day_type_match": any(f.endswith(f"_{dtype}.csv") for f in network.night_files(dtype))}


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

GROUP_TTL = dt.timedelta(hours=24)       # F3-08: 만든 뒤 24시간이 지나면 주소와 함께 지운다


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
    for table, col, kind in (("members", "toss_id", "text"), ("members", "token_hash", "text"),
                             ("members", "area", "text"), ("groups", "admin_hash", "text"),
                             ("groups", "version", "integer default 1"), ("groups", "expires_at", "text"),
                             ("groups", "departure", "text"), ("groups", "status", "text default 'active'")):
        if col not in {r[1] for r in con.execute(f"pragma table_info({table})")}:
            con.execute(f"alter table {table} add column {col} {kind}")
    con.execute("""create table if not exists feedback (
        id integer primary key autoincrement, created_at text, search_id text, option_id text, option_kind text,
        fare_lo integer, fare_hi integer, actual_fare integer, skipped integer, distance_band text, hour integer)""")
    con.execute("""create table if not exists events (
        id integer primary key autoincrement, created_at text, device_id text, name text, area text,
        option_kind text)""")
    return con


def now_iso():
    return dt.datetime.now(KST).isoformat(timespec="seconds")


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _bearer(authorization):
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def purge_expired(con):
    """24시간 지난 모임: 참여자(집 주소)를 지우고 모임은 expired로 남긴다 (링크를 열면 '끝난 모임' 안내).
    7일 지난 모임 기록은 아예 지운다."""
    now = dt.datetime.now(KST)
    for g in con.execute("select id, created_at, expires_at, status from groups").fetchall():
        exp = dt.datetime.fromisoformat(g["expires_at"]) if g["expires_at"] else \
            dt.datetime.fromisoformat(g["created_at"]) + GROUP_TTL
        if now >= exp + dt.timedelta(days=7):
            con.execute("delete from members where group_id=?", (g["id"],))
            con.execute("delete from groups where id=?", (g["id"],))
        elif now >= exp and g["status"] != "expired":
            con.execute("delete from members where group_id=?", (g["id"],))
            con.execute("update groups set status='expired', meet_lat=null, meet_lng=null where id=?", (g["id"],))


def load_group(con, gid, allow_expired=False):
    purge_expired(con)
    g = con.execute("select * from groups where id=?", (gid,)).fetchone()
    if not g:
        raise HTTPException(404, "모임이 없어요")
    if g["status"] in ("expired", "ended") and not allow_expired:
        raise HTTPException(410, "끝난 모임이에요")
    return g


def is_admin(g, token):
    return bool(token) and g["admin_hash"] is not None and secrets.compare_digest(g["admin_hash"], _hash(token))


def area_of(lat, lng):
    """F3-10: 다른 사람에게 보여줄 위치 = 동 이름 + 가까운 역 이름 (주소·좌표는 안 보낸다)."""
    st = stations()
    d = (st.lat - lat) ** 2 + ((st.lng - lng) * 0.79) ** 2
    near = st.loc[d.idxmin(), "name"] if len(st) else None
    station = (near if str(near).endswith("역") else f"{near}역") if near else None
    r = naver.reverse(lat, lng)
    dong = f"{r['gu']} {r['dong']}" if r and r.get("dong") else None
    return " · ".join(x for x in (dong, f"{station} 근처" if station else None) if x) or "위치 비공개"


def unique_nickname(con, gid, nickname, exclude_id=None):
    """F3-04: 모임 안에서 겹치면 뒤에 번호 (민수, 민수2, 민수3 …)."""
    taken = {r["nickname"] for r in con.execute("select id, nickname from members where group_id=?", (gid,))
             if r["id"] != exclude_id}
    name, n = nickname.strip(), 2
    out = name
    while out in taken:
        out, n = f"{name}{n}", n + 1
    return out


def bump(con, gid):
    con.execute("update groups set version = coalesce(version, 1) + 1 where id=?", (gid,))


@app.post("/api/groups")
def create_group(req: GroupCreate):
    """F3-01·02·03: 모임 만들기 → 임의 ID(16자) + 관리 토큰(만든 사람 브라우저에만 저장)."""
    if req.departure_time is None and req.date is not None:
        h, m = map(int, APP_CFG["group_deadline_from"].split(":"))
        start = dt.datetime.combine(req.date, dt.time(h, m), tzinfo=KST)
    else:
        start = resolve_time(req.departure_time)
    day, _, _ = service_day(start)
    gid = secrets.token_urlsafe(12)              # 16자
    admin = secrets.token_urlsafe(24)
    created = dt.datetime.now(KST)
    expires = created + GROUP_TTL
    with db() as con:
        con.execute("insert into groups (id, name, meet_lat, meet_lng, meet_label, date, created_at, admin_hash, "
                    "version, expires_at, departure, status) values (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (gid, req.name, req.meeting_place.lat, req.meeting_place.lng, req.meeting_place.label,
                     day.isoformat(), created.isoformat(timespec="seconds"), _hash(admin), 1,
                     expires.isoformat(timespec="seconds"), start.isoformat(timespec="seconds"), "active"))
    return {"id": gid, "share_path": f"/g/{gid}", "admin_token": admin,
            "departure": start.isoformat(timespec="seconds"), "expires_at": expires.isoformat(timespec="seconds"),
            "notes": ["admin_token은 만든 사람 브라우저에만 저장하고 Authorization: Bearer 헤더로 보낸다 (다시 받을 수 없음)"]}


@app.delete("/api/groups/{gid}")
def end_group(gid: str, authorization: Optional[str] = Header(None)):
    """F3-08: 만든 사람이 모임 종료 → 참여자 주소를 바로 지운다."""
    with db() as con:
        g = load_group(con, gid)
        if not is_admin(g, _bearer(authorization)):
            raise HTTPException(403, "만든 사람만 모임을 끝낼 수 있어요")
        con.execute("delete from members where group_id=?", (gid,))
        con.execute("update groups set status='ended', meet_lat=null, meet_lng=null where id=?", (gid,))
        bump(con, gid)
    _drop_cache(gid)
    return {"id": gid, "status": "ended"}


@app.post("/api/groups/{gid}/members")
def add_member(gid: str, req: MemberCreate, authorization: Optional[str] = Header(None)):
    """F3-04·06: 참여 → 참여자 토큰. 만든 사람이 대신 넣을 때도 같은 주소 (관리 토큰을 보내면 by_admin)."""
    area = area_of(req.home.lat, req.home.lng)
    mid = secrets.token_urlsafe(12)
    token = secrets.token_urlsafe(24)
    with db() as con:
        g = load_group(con, gid)
        by_admin = is_admin(g, _bearer(authorization))
        nick = unique_nickname(con, gid, req.nickname)
        con.execute("insert into members (id, group_id, nickname, home_lat, home_lng, home_label, created_at, "
                    "token_hash, area) values (?,?,?,?,?,?,?,?,?)",
                    (mid, gid, nick, req.home.lat, req.home.lng, req.home.label, now_iso(), _hash(token), area))
        bump(con, gid)
    return {"id": mid, "nickname": nick, "member_token": token, "area": area, "by_admin": by_admin}


def _member_auth(con, gid, mid, authorization):
    g = load_group(con, gid)
    m = con.execute("select * from members where id=? and group_id=?", (mid, gid)).fetchone()
    if not m:
        raise HTTPException(404, "참여자가 없어요")
    tok = _bearer(authorization)
    own = bool(tok) and m["token_hash"] is not None and secrets.compare_digest(m["token_hash"], _hash(tok))
    if not (own or is_admin(g, tok)):
        raise HTTPException(403, "본인이나 만든 사람만 바꿀 수 있어요")
    return g, m


@app.patch("/api/groups/{gid}/members/{mid}")
def update_member(gid: str, mid: str, req: MemberUpdate, authorization: Optional[str] = Header(None)):
    """F3-05·06: 닉네임·집 주소 고치기 (참여자 토큰 또는 관리 토큰)."""
    with db() as con:
        _, m = _member_auth(con, gid, mid, authorization)
        nick = unique_nickname(con, gid, req.nickname, exclude_id=mid) if req.nickname else m["nickname"]
        lat, lng, label, area = m["home_lat"], m["home_lng"], m["home_label"], m["area"]
        if req.home is not None:
            lat, lng, label, area = req.home.lat, req.home.lng, req.home.label, area_of(req.home.lat, req.home.lng)
        con.execute("update members set nickname=?, home_lat=?, home_lng=?, home_label=?, area=? where id=?",
                    (nick, lat, lng, label, area, mid))
        bump(con, gid)
    _drop_cache(gid)
    return {"id": mid, "nickname": nick, "area": area}


@app.delete("/api/groups/{gid}/members/{mid}")
def remove_member(gid: str, mid: str, authorization: Optional[str] = Header(None)):
    """F3-05·03: 빠지기 (본인) / 참여자 삭제 (만든 사람). 주소도 바로 지운다."""
    with db() as con:
        _member_auth(con, gid, mid, authorization)
        con.execute("delete from members where id=?", (mid,))
        bump(con, gid)
    _drop_cache(gid)
    return {"id": mid, "deleted": True}


@app.post("/api/feedback")
def feedback(req: Feedback):
    """F2-09·10: 실제 택시비 (주소 없이 거리대·시간대만 남긴다)."""
    band = None
    if req.distance_m is not None:
        km = req.distance_m / 1000
        band = "~5km" if km < 5 else "5~10km" if km < 10 else "10~20km" if km < 20 else "20km~"
    hour = None
    if req.departure:
        try:
            hour = resolve_time(req.departure).hour
        except ValueError:
            hour = None
    lo, hi = (req.fare_range or [None, None])
    with db() as con:
        cur = con.execute("insert into feedback (created_at, search_id, option_id, option_kind, fare_lo, fare_hi, "
                          "actual_fare, skipped, distance_band, hour) values (?,?,?,?,?,?,?,?,?,?)",
                          (now_iso(), req.search_id, req.option_id, req.option_kind, lo, hi, req.actual_fare,
                           int(req.skipped or req.actual_fare is None), band, hour))
    out = {"id": cur.lastrowid, "saved": True}
    if req.actual_fare is not None and lo is not None:
        out["within_range"] = lo <= req.actual_fare <= hi
    return out


@app.post("/api/events")
def events(req: Event):
    """사용 기록 (익명 기기 ID, 이벤트 이름, 동 이름까지만)."""
    with db() as con:
        con.execute("insert into events (created_at, device_id, name, area, option_kind) values (?,?,?,?,?)",
                    (now_iso(), req.device_id, req.name, req.area, req.option_kind))
    return {"saved": True}


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


def _drop_cache(gid):
    for k in [k for k in _deadline_cache if k[0] == gid]:
        del _deadline_cache[k]


def extra_if_late(dl, day, meet, home, dtype):
    """F3-12: 마감을 넘기면 더 드는 돈 = 마감 1분 뒤 택시 직행 추정 요금 − 마감 안 대중교통 요금.
    심야버스로 계속 갈 수 있으면 그 요금 차이를 함께 준다."""
    reg = dl.get("regular")
    if reg is None:
        return None
    t_late = int((dt.datetime.fromisoformat(reg["latest"]) - dt.datetime.combine(day, dt.time(0), tzinfo=KST))
                 .total_seconds()) + 60
    a, b = raptor.to_xy([meet[0]], [meet[1]])[0], raptor.to_xy([home[0]], [home[1]])[0]
    taxi = int(raptor.fares.taxi_trip(np.array([float(np.linalg.norm(a - b))]), np.array([t_late]))["fare"][0])
    fare = reg["route"]["fare"]
    out = {"taxi_fare": taxi, "amount": max(taxi - fare, 0),
           "message": f"이 시각을 넘기면 {max(taxi - fare, 0):,}원 더 들어요 (택시 직행 추정)"}
    nb = dl.get("night")
    if nb is not None and nb["latest"] > reg["latest"]:
        out["night_bus_fare"] = nb["route"]["fare"]
        out["night_bus_until"] = nb["latest"]
    return out


@app.get("/api/groups/{gid}")
def get_group(gid: str, leave_at: Optional[dt.datetime] = None, authorization: Optional[str] = Header(None)):
    """모임 정보 + 사람별 출발 마감 (모임 장소 → 각자 집).
    다른 사람의 집은 area(동 이름 · 가까운 역)만 보낸다. 본인(참여자 토큰)에게만 home(좌표·주소)을 준다.
    version: 참여자가 바뀔 때마다 올라간다 → 폴링에서 같으면 다시 그리지 않아도 된다.
    leave_at(모임이 끝나는 시각)을 주면, 그때 지하철·일반버스 막차가 끊긴 사람끼리 택시를 묶고 정산한다."""
    tok = _bearer(authorization)
    with db() as con:
        g = load_group(con, gid, allow_expired=True)
        if g["status"] in ("expired", "ended"):
            return {"id": g["id"], "name": g["name"], "status": "expired", "version": g["version"] or 1,
                    "members": [], "notes": ["끝난 모임이에요. 주소는 지웠어요"]}
        members = con.execute("select * from members where group_id=? order by created_at", (gid,)).fetchall()
    if g["departure"]:
        start = dt.datetime.fromisoformat(g["departure"])
    else:
        h, m = map(int, APP_CFG["group_deadline_from"].split(":"))
        start = dt.datetime.combine(dt.date.fromisoformat(g["date"]), dt.time(h, m), tzinfo=KST)
    day, t0, dtype = service_day(start)
    net = get_net(dtype)
    meet = (g["meet_lat"], g["meet_lng"])
    out, dls = [], {}
    for mb in members:
        home = (mb["home_lat"], mb["home_lng"])
        key = (g["id"], mb["id"], dtype, id(net), home, t0)
        if key not in _deadline_cache:
            d = deadline_mod.deadlines(net, meet, home, t0)
            dj = deadline_json(d, day)
            if dj.get("regular"):
                dj["regular"]["extra_if_late"] = extra_if_late(dj, day, meet, home, dtype)
            _deadline_cache[key] = dj
        dls[mb["id"]] = _deadline_cache[key]
        is_me = bool(tok) and mb["token_hash"] is not None and secrets.compare_digest(mb["token_hash"], _hash(tok))
        item = {"id": mb["id"], "nickname": mb["nickname"], "area": mb["area"] or area_of(*home), "is_me": is_me,
                "deadline": _deadline_cache[key]}
        if is_me:
            item["home"] = {"lat": mb["home_lat"], "lng": mb["home_lng"], "label": mb["home_label"]}
        out.append(item)
    out.sort(key=lambda x: (x["deadline"]["regular"] or {}).get("leave_by") or "9999")
    taxi_groups = transfers = None
    if leave_at is not None:
        taxi_groups, transfers = taxi_groups_json(g, members, dls, leave_at)
    return {"id": g["id"], "name": g["name"], "status": "ready", "version": g["version"] or 1,
            "is_admin": is_admin(g, tok), "date": g["date"], "day_type": dtype,
            "departure": start.isoformat(timespec="seconds"), "expires_at": g["expires_at"],
            "meeting_place": {"lat": g["meet_lat"], "lng": g["meet_lng"], "label": g["meet_label"]},
            "members": out, "leave_at": leave_at.isoformat() if leave_at else None,
            "taxi_groups": taxi_groups, "settlement": transfers,
            "notes": ["leave_at을 주면 그때 막차(지하철·일반버스)가 끊긴 사람끼리 택시를 묶습니다",
                      "택시 요금과 settlement는 예상값입니다. 내린 뒤 실제 금액은 POST /api/settle로 다시 나눕니다 (송금은 각자)",
                      "택시 요금은 네이버 실제 경로(경유지 포함) 기준이고(키가 없거나 한도를 넘으면 추정), 정산은 내리는 곳 기준입니다",
                      "solo_fare(혼자 탔을 때)는 추정값이라 saving은 참고용입니다",
                      "다른 사람의 집은 area(동 · 가까운 역)만 보입니다. home은 본인 토큰으로 요청할 때만 옵니다"]}

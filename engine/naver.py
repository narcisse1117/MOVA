"""
네이버 클라우드 Directions 5 (택시 실제 경로 거리·시간).

- 인증키: 데이터/naver_key.txt (첫 줄 Client ID, 둘째 줄 Client Secret). 없으면 available() = False
- 무료 이용량이 월 60,000건이라 아껴 쓴다:
  * 같은 좌표(소수 넷째 자리, 약 10m) 구간은 engine/cache/naver.sqlite에 저장해 두고 다시 부르지 않는다
  * 이번 달 호출 수가 config/fares.json의 naver.monthly_limit를 넘으면 부르지 않는다 (추정으로 돌아감)
- 경유지는 최대 5개 (모임 택시: 모임 장소 → 집1 → … → 마지막 집)
- 응답의 시간(duration)은 '지금' 교통 기준이다. 나중 시각 계산에는 거리만 쓰고 시간은 심야 속도로 다시 구한다
"""
import datetime as dt
import json
import os
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request

ENGINE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ENGINE)
KEY_PATH = os.path.join(ROOT, "데이터", "naver_key.txt")
DB_PATH = os.path.join(ENGINE, "cache", "naver.sqlite")
URL = "https://maps.apigw.ntruss.com/map-direction/v1/driving"
GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
REVERSE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc"
LOCAL_URL = "https://naverapihub.apigw.ntruss.com/search/v1/local"
SEARCH_KEY_PATH = os.path.join(ROOT, "데이터", "naver_search_key.txt")
with open(os.path.join(ROOT, "config", "fares.json"), encoding="utf-8") as _f:
    CFG = json.load(_f).get("naver", {})
MONTHLY_LIMIT = CFG.get("monthly_limit", 55000)
LOCAL_DAILY_LIMIT = CFG.get("local_search_daily_limit", 20000)
DAILY_LIMIT = CFG.get("daily_limit", 1900)       # 한 사람이 몰아 써도 한 달 한도가 며칠 만에 바닥나지 않게
ENABLED = CFG.get("enabled", True)
DURATION_FRESH_MIN = 15      # 저장된 소요 시간을 '지금 교통'으로 믿는 시간

_lock = threading.Lock()
_key = None


def _load_key():
    global _key
    if _key is None and os.path.exists(KEY_PATH):
        lines = [l.strip() for l in open(KEY_PATH, encoding="utf-8-sig").read().splitlines() if l.strip()]
        if len(lines) >= 2:
            _key = (lines[0], lines[1])
    return _key


def available():
    return ENABLED and _load_key() is not None


def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("create table if not exists routes (k text primary key, dist_m integer, duration_sec integer, "
                "legs text, fetched_at text)")
    con.execute("create table if not exists usage (month text primary key, calls integer)")
    con.execute("create table if not exists geo (k text primary key, v text, fetched_at text)")
    return con


def _key_of(points):
    return "|".join(f"{lat:.4f},{lng:.4f}" for lat, lng in points)


def usage_this_month():
    with _lock, _db() as con:
        r = con.execute("select calls from usage where month=?", (dt.date.today().strftime("%Y-%m"),)).fetchone()
        return r[0] if r else 0


def usage_today():
    with _lock, _db() as con:
        r = con.execute("select calls from usage where month=?", (dt.date.today().strftime("%Y-%m-%d"),)).fetchone()
        return r[0] if r else 0


def route(points, need_fresh_duration=False):
    """points: [(lat, lng), ...] 출발 → (경유지…) → 도착. 결과 {dist_m, duration_sec, legs:[(dist_m, sec)], fresh}
    부를 수 없거나 실패하면 None."""
    if len(points) < 2 or len(points) > 7 or not available():
        return None
    k = _key_of(points)
    now = dt.datetime.now()
    with _lock, _db() as con:
        row = con.execute("select dist_m, duration_sec, legs, fetched_at from routes where k=?", (k,)).fetchone()
    if row:
        fetched = dt.datetime.fromisoformat(row[3])
        fresh = now - fetched < dt.timedelta(minutes=DURATION_FRESH_MIN)
        if fresh or not need_fresh_duration:
            return {"dist_m": row[0], "duration_sec": row[1], "legs": json.loads(row[2]), "fresh": fresh, "cached": True}
    month, day = now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")
    with _lock, _db() as con:
        r = con.execute("select calls from usage where month=?", (month,)).fetchone()
        d = con.execute("select calls from usage where month=?", (day,)).fetchone()
        if (r[0] if r else 0) >= MONTHLY_LIMIT or (d[0] if d else 0) >= DAILY_LIMIT:
            return None
        for key in (month, day):     # usage 표에 월(YYYY-MM)과 일(YYYY-MM-DD)을 같이 센다
            con.execute("insert into usage values (?, 1) on conflict(month) do update set calls = calls + 1", (key,))
    cid, sec = _load_key()
    p = {"start": f"{points[0][1]},{points[0][0]}", "goal": f"{points[-1][1]},{points[-1][0]}", "option": "trafast"}
    if len(points) > 2:
        p["waypoints"] = "|".join(f"{lng},{lat}" for lat, lng in points[1:-1])
    req = urllib.request.Request(f"{URL}?{urllib.parse.urlencode(p)}",
                                 headers={"x-ncp-apigw-api-key-id": cid, "x-ncp-apigw-api-key": sec})
    try:
        j = json.loads(urllib.request.urlopen(req, timeout=10).read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    if j.get("code") != 0:
        return None
    s = j["route"]["trafast"][0]["summary"]
    total_d, total_t = int(s["distance"]), int(s["duration"] / 1000)
    legs = [(int(w["distance"]), int(w["duration"] / 1000)) for w in s.get("waypoints", [])]
    used_d, used_t = sum(l[0] for l in legs), sum(l[1] for l in legs)
    legs.append((total_d - used_d, total_t - used_t))     # 마지막 경유지 → 도착
    with _lock, _db() as con:
        con.execute("insert or replace into routes values (?,?,?,?,?)",
                    (k, total_d, total_t, json.dumps(legs), now.isoformat(timespec="seconds")))
    return {"dist_m": total_d, "duration_sec": total_t, "legs": legs, "fresh": True, "cached": False}


def _get_json(url, params, key=None):
    cid, sec = key or _load_key()
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}",
                                 headers={"x-ncp-apigw-api-key-id": cid, "x-ncp-apigw-api-key": sec,
                                          "Accept": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=8).read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def _geo_cached(k, fetch):
    with _lock, _db() as con:
        row = con.execute("select v from geo where k=?", (k,)).fetchone()
    if row:
        return json.loads(row[0])
    v = fetch()
    if v is not None:
        with _lock, _db() as con:
            con.execute("insert or replace into geo values (?,?,?)",
                        (k, json.dumps(v, ensure_ascii=False), dt.datetime.now().isoformat(timespec="seconds")))
    return v


def geocode(query):
    """주소 → [{address, jibun, lat, lng}] (장소 이름은 못 찾는다). 무료 월 300만 건."""
    if not available() or not query.strip():
        return []

    def fetch():
        j = _get_json(GEOCODE_URL, {"query": query})
        if j is None or j.get("status") != "OK":
            return None
        return [{"address": a.get("roadAddress") or a.get("jibunAddress"), "jibun": a.get("jibunAddress"),
                 "lat": float(a["y"]), "lng": float(a["x"])} for a in j.get("addresses", [])]
    return _geo_cached("g:" + query.strip(), fetch) or []


def reverse(lat, lng):
    """좌표 → {gu, dong, road} (예: 노원구, 상계동). 무료 월 300만 건."""
    if not available():
        return None

    def fetch():
        j = _get_json(REVERSE_URL, {"coords": f"{lng},{lat}", "output": "json", "orders": "roadaddr,admcode"})
        if j is None or not j.get("results"):
            return None
        reg = j["results"][0]["region"]
        road = None
        for r in j["results"]:
            if r.get("name") == "roadaddr" and r.get("land"):
                land = r["land"]
                road = f"{land.get('name', '')} {land.get('number1', '')}".strip()
        return {"si": reg["area1"]["name"], "gu": reg["area2"]["name"], "dong": reg["area3"]["name"], "road": road}
    return _geo_cached(f"r:{lat:.4f},{lng:.4f}", fetch)


_search_key = None


def _load_search_key():
    global _search_key
    if _search_key is None and os.path.exists(SEARCH_KEY_PATH):
        lines = [l.strip() for l in open(SEARCH_KEY_PATH, encoding="utf-8-sig").read().splitlines() if l.strip()]
        if len(lines) >= 2:
            _search_key = (lines[0], lines[1])
    return _search_key


def local_search(query, n=5):
    """가게·장소 이름 → [{name, address, jibun, category, lat, lng}] (NAVER API HUB 지역 검색, 최대 5개).
    같은 검색어는 저장해 두고, 하루 LOCAL_DAILY_LIMIT건을 넘으면 부르지 않는다."""
    key = _load_search_key()
    if key is None or not query.strip():
        return []
    q = query.strip()

    def fetch():
        day = "local:" + dt.date.today().isoformat()
        with _lock, _db() as con:
            r = con.execute("select calls from usage where month=?", (day,)).fetchone()
            if (r[0] if r else 0) >= LOCAL_DAILY_LIMIT:
                return None
            con.execute("insert into usage values (?, 1) on conflict(month) do update set calls = calls + 1", (day,))
        j = _get_json(LOCAL_URL, {"query": q, "display": n}, key=key)
        if j is None:
            return None
        out = []
        for it in j.get("items", []):
            try:
                lng, lat = int(it["mapx"]) / 1e7, int(it["mapy"]) / 1e7
            except (KeyError, ValueError):
                continue
            name = it.get("title", "").replace("<b>", "").replace("</b>", "").replace("&amp;", "&")
            out.append({"name": name, "address": it.get("roadAddress") or it.get("address"),
                        "jibun": it.get("address"), "category": it.get("category"), "lat": lat, "lng": lng})
        return out
    return _geo_cached("l:" + q, fetch) or []

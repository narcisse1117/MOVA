"""
첫 구간 실시간 반영 (버스): 지금 출발하는 사람에게 첫 버스의 실제 도착 예정·막차 여부를 붙인다.

버스도착정보조회 getArrInfoByRoute(stId, busRouteId, ord)로 다음 버스 두 대의 도착 예정(초)·막차 여부를 받고,
정류장까지 걸어가는 시간 뒤에 탈 수 있는 첫 버스를 고른다.

status
  ok      탈 수 있는 버스가 시간표(엔진 예정)와 RT_OK_SEC 안으로 온다
  later   예정보다 늦게 온다 (delay_sec만큼 도착도 늦어질 수 있음)
  earlier 예정보다 일찍 온다
  missed  걸어가는 동안 남은 버스가 모두 지나간다 (막차를 놓침)
  ended   운행 종료
  unknown 조회 실패
지하철: 서울 열린데이터광장 실시간 도착정보(데이터/seoul_subway_key.txt, 실시간 전용 키).
  역 이름으로 조회 → 같은 열차 번호를 찾고, 없으면 같은 노선·같은 행선지에서 탈 수 있는 첫 열차.
"""
import datetime as dt
import re
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_PATH = os.path.join(ROOT, "데이터", "seoul_key2.txt")
URL = "http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRoute"
SUBWAY_KEY_PATH = os.path.join(ROOT, "데이터", "seoul_subway_key.txt")
SUBWAY_URL = "http://swopenapi.seoul.go.kr/api/subway/{key}/json/realtimeStationArrival/0/40/{station}"
CACHE_SEC = 30
RT_OK_SEC = 180
# 엔진의 노선 이름 → 실시간 API의 subwayId
SUBWAY_ID = {"1호선": "1001", "경인선": "1001", "경부선": "1001", "2호선": "1002", "3호선": "1003", "일산선": "1003",
             "4호선": "1004", "안산과천선": "1004", "5호선": "1005", "6호선": "1006", "7호선": "1007",
             "수도권 도시철도 7호선": "1007", "8호선": "1008", "9호선": "1009", "경의중앙선": "1063",
             "인천국제공항선": "1065", "경춘선": "1067", "수인분당선": "1075", "신분당선": "1077",
             "우이신설선": "1092", "서해선": "1093", "신림선": "1094"}

_cache = {}
_keys = None
_key_i = 0


def _get_keys():
    global _keys
    if _keys is None:
        _keys = open(KEY_PATH, encoding="utf-8-sig").read().split() if os.path.exists(KEY_PATH) else []
    return _keys


def available():
    return bool(_get_keys()) or _subway_key() is not None


_skey = None


def _subway_key():
    global _skey
    if _skey is None and os.path.exists(SUBWAY_KEY_PATH):
        lines = [l.strip() for l in open(SUBWAY_KEY_PATH, encoding="utf-8-sig").read().splitlines() if l.strip()]
        _skey = lines[0] if lines else ""
    return _skey or None


def _parse_msg_sec(msg):
    """'4분 30초 후' → 270, '3분 후' → 180, 'OO 도착' → 0. 모르면 None."""
    m = re.search(r"(\d+)분\s*(\d+)?초?\s*후", msg or "")
    if m:
        return int(m.group(1)) * 60 + int(m.group(2) or 0)
    if "도착" in (msg or "") and "전역" not in msg:
        return 0
    return None


def subway_arrivals(station):
    """역 이름 → [{line_id, train, terminus, sec(지금 기준 남은 초), is_last, msg}], 실패면 None."""
    key = _subway_key()
    if key is None:
        return None
    names = [station]
    base = re.sub(r"\(.*?\)", "", station).replace("역", "").strip()
    if base and base != station:
        names.append(base)
    for name in names:
        k = ("subway", name)
        hit = _cache.get(k)
        if hit and time.time() - hit[0] < CACHE_SEC:
            if hit[1]:
                return hit[1]
            continue
        res = None
        try:
            url = SUBWAY_URL.format(key=key, station=urllib.parse.quote(name))
            j = json.loads(urllib.request.urlopen(url, timeout=6).read())
            now = dt.datetime.now()
            res = []
            for x in j.get("realtimeArrivalList") or []:
                sec = int(x.get("barvlDt") or 0)
                if sec <= 0:
                    sec = _parse_msg_sec(x.get("arvlMsg2"))
                if sec is None:
                    continue          # '[3]번째 전역'처럼 시간이 없으면 뺀다
                try:            # 자료 시각(recptnDt) 이후 지난 만큼 뺀다
                    age = (now - dt.datetime.strptime(x.get("recptnDt", ""), "%Y-%m-%d %H:%M:%S")).total_seconds()
                    sec = max(0, int(sec - max(0, age)))
                except ValueError:
                    pass
                res.append({"line_id": str(x.get("subwayId")), "train": str(x.get("btrainNo") or "").lstrip("0"),
                            "terminus": (x.get("bstatnNm") or "").replace("행", "").strip(), "sec": sec,
                            "is_last": str(x.get("lstcarAt")) == "1", "msg": x.get("arvlMsg2")})
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            res = None
        _cache[k] = (time.time(), res)
        if res:
            return res
    return None


def _annotate_rail(l, lead, now_sec):
    m = re.match(r"^(\S+)\s+(.+?)행", l.get("trip", ""))
    if not m:
        return {"status": "unknown"}
    train, terminus = m.group(1).lstrip("0"), m.group(2)
    trains = subway_arrivals(l["from"])
    if trains is None:
        return {"status": "unknown"}
    line_id = SUBWAY_ID.get(l["line"])
    same_line = [t for t in trains if t["line_id"] == line_id]
    # 1) 같은 열차 번호
    for t in same_line:
        if t["train"] and t["train"] == train:
            rt_dep = now_sec + t["sec"]
            delay = rt_dep - l["dep"]
            if t["sec"] < lead:
                return {"status": "missed", "message": f"걸어가는 동안 {t['msg']}", "is_last": t["is_last"]}
            status = "ok" if abs(delay) <= RT_OK_SEC else ("later" if delay > 0 else "earlier")
            return {"status": status, "arrive_in_sec": t["sec"], "realtime_dep": int(rt_dep), "delay_sec": int(delay),
                    "is_last": t["is_last"], "message": t["msg"], "matched": "train"}
    # 2) 같은 노선·같은 행선지에서 탈 수 있는 첫 열차
    same_dir = [t for t in same_line if t["terminus"] and (t["terminus"] in terminus or terminus in t["terminus"])]
    if same_dir and any(t["is_last"] and t["sec"] < lead for t in same_dir):
        return {"status": "missed", "message": "걸어가는 동안 막차가 떠남", "is_last": True}
    catch = sorted((t for t in same_dir if t["sec"] >= lead), key=lambda t: t["sec"])
    if not catch:
        return {"status": "unknown"}     # 실시간 목록에 아직 없음 (보통 다음 두 대만 나온다)
    t = catch[0]
    rt_dep = now_sec + t["sec"]
    delay = rt_dep - l["dep"]
    status = "ok" if abs(delay) <= RT_OK_SEC else ("later" if delay > 0 else "earlier")
    return {"status": status, "arrive_in_sec": t["sec"], "realtime_dep": int(rt_dep), "delay_sec": int(delay),
            "is_last": t["is_last"], "message": t["msg"], "matched": "direction"}


def arrivals(st_id, route_id, seq):
    """정류장·노선의 다음 버스 두 대 → [{sec, is_last, msg, plate}], 운행 종료면 'ended', 실패면 None."""
    global _key_i
    k = (st_id, route_id, seq)
    hit = _cache.get(k)
    if hit and time.time() - hit[0] < CACHE_SEC:
        return hit[1]
    keys = _get_keys()
    res = None
    for _ in range(len(keys)):
        q = urllib.parse.urlencode({"serviceKey": keys[_key_i], "stId": st_id, "busRouteId": route_id,
                                    "ord": seq, "resultType": "json"})
        try:
            j = json.loads(urllib.request.urlopen(f"{URL}?{q}", timeout=6).read())
            if str((j.get("msgHeader") or {}).get("headerCd")) not in ("0", "4"):
                raise RuntimeError("headerCd")
            items = (j.get("msgBody") or {}).get("itemList") or []
            if not items:
                res = []
                break
            x = items[0]
            buses = []
            for n in ("1", "2"):
                msg = (x.get("arrmsg" + n) or "").strip()
                if "운행종료" in msg or "출발대기" in msg and n == "1" and not x.get("traTime" + n):
                    continue
                try:
                    sec = int(x.get("traTime" + n) or 0)
                except ValueError:
                    sec = 0
                if sec <= 0 and "곧 도착" not in msg:
                    continue
                buses.append({"sec": sec, "is_last": str(x.get("isLast" + n)) == "1", "msg": msg,
                              "plate": (x.get("plainNo" + n) or "").strip()})
            if not buses and "운행종료" in (x.get("arrmsg1") or ""):
                res = "ended"
            else:
                res = buses
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError):
            _key_i = (_key_i + 1) % len(keys)
    _cache[k] = (time.time(), res)
    return res


def annotate_option(legs, now_sec):
    """경로 하나의 첫 버스 구간에 실시간 정보를 붙인다 (legs를 제자리에서 바꿈).
    첫 탈것이 버스가 아니면 아무것도 안 한다. 첫 탈것 전 걷기·택시 시간은 legs에서 계산한다."""
    lead = 0
    for l in legs:
        if l["type"] == "walk":
            lead += l["sec"]
            continue
        if l["type"] == "taxi":
            lead = l["arr"] - now_sec
            continue
        if l["type"] == "rail":
            info = _annotate_rail(l, lead, now_sec)
            l["realtime"] = info
            return info
        if l["type"] != "bus" or not l.get("board_stop_id") or not l.get("route_id"):
            return None
        buses = arrivals(l["board_stop_id"], l["route_id"], l["board_seq"])
        if buses is None:
            info = {"status": "unknown"}
        elif buses == "ended":
            info = {"status": "ended", "message": "운행종료"}
        else:
            catch = [b for b in buses if b["sec"] >= lead]
            if not catch:
                gone_last = any(b["is_last"] for b in buses)
                info = {"status": "missed", "message": "걸어가는 동안 " + ("막차가" if gone_last else "다음 두 대가") + " 지나감",
                        "next": buses}
            else:
                b = catch[0]
                rt_dep = now_sec + b["sec"]
                delay = rt_dep - l["dep"]
                status = "ok" if abs(delay) <= RT_OK_SEC else ("later" if delay > 0 else "earlier")
                info = {"status": status, "arrive_in_sec": b["sec"], "realtime_dep": int(rt_dep),
                        "delay_sec": int(delay), "is_last": b["is_last"], "message": b["msg"], "plate": b["plate"]}
        l["realtime"] = info
        return info
    return None


def annotate_plan(p, now_sec):
    """raptor.plan() 결과의 대중교통·조합 경로 전부에 첫 탈것(버스·지하철) 실시간을 붙인다."""
    if not available():
        return p
    for r in p.get("transit", []) + p.get("combo", []):
        annotate_option(r["legs"], now_sec)
    return p

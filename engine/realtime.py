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
지하철 실시간은 아직 없다 (다른 API).
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_PATH = os.path.join(ROOT, "데이터", "seoul_key2.txt")
URL = "http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRoute"
CACHE_SEC = 30
RT_OK_SEC = 180

_cache = {}
_keys = None
_key_i = 0


def _get_keys():
    global _keys
    if _keys is None:
        _keys = open(KEY_PATH, encoding="utf-8-sig").read().split() if os.path.exists(KEY_PATH) else []
    return _keys


def available():
    return bool(_get_keys())


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
    """raptor.plan() 결과의 대중교통·조합 경로 전부에 첫 버스 실시간을 붙인다."""
    if not available():
        return p
    for r in p.get("transit", []) + p.get("combo", []):
        annotate_option(r["legs"], now_sec)
    return p

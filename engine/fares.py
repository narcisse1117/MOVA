"""
택시 시간·요금 추정과 대중교통 요금 계산. 숫자는 모두 config/fares.json에서 읽는다.

택시 거리·시간은 지금은 직선거리 × 우회 계수와 시간대별 속도로 추정한다.
네이버 Directions 5를 붙이면 taxi_trip()의 거리·시간만 바꾸면 된다.
"""
import json
import math
import os

import numpy as np

import naver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "config", "fares.json"), encoding="utf-8") as _f:
    CFG = json.load(_f)
TAXI = CFG["taxi_seoul_midsize"]
EST = CFG["taxi_estimate"]
TRANSIT = CFG["transit_seoul_card_adult"]
VALUE_PER_MIN = CFG["choice"]["value_won_per_min"]

_BAND_OF_HOUR = {h: name for name, b in TAXI["bands"].items() for h in b["hours"]}


def _by_hour(table, hour):
    return np.vectorize(lambda h: table.get(str(int(h)), table["default"]))(hour)


def taxi_fare(dist_m, drive_sec, start_sec):
    """미터기 요금 (부분 동시병산 근사). 저속 구간 비율만큼 시간 요금, 나머지는 거리 요금."""
    dist_m = np.asarray(dist_m, dtype=float)
    drive_sec = np.asarray(drive_sec, dtype=float)
    hour = (np.asarray(start_sec) // 3600) % 24
    band = np.vectorize(lambda h: _BAND_OF_HOUR.get(int(h), "day"))(hour)
    base = np.vectorize(lambda b: TAXI["bands"][b]["base"])(band)
    unit = np.vectorize(lambda b: TAXI["bands"][b]["unit"])(band)
    low_sec = drive_sec * EST["low_speed_share"]
    low_m = low_sec * (TAXI["time_fare_below_kmh"] / 3.6) * 0.5      # 저속 구간에서 간 거리 (속도 절반으로 근사)
    dist_units = np.floor(np.maximum(dist_m - low_m - TAXI["base_distance_m"], 0) / TAXI["distance_unit_m"])
    time_units = np.floor(low_sec / TAXI["time_unit_sec"])
    fare = base + (dist_units + time_units) * unit
    r = TAXI["round_to"]
    return (np.floor(fare / r + 0.5) * r).astype(int)


def taxi_trip(straight_m, start_sec):
    """직선거리(m)와 출발 시각 → 대기·운전 시간, 요금(가운데·낮음·높음)."""
    straight_m = np.asarray(straight_m, dtype=float)
    hour = (np.asarray(start_sec) // 3600) % 24
    speed = _by_hour(EST["speed_kmh_by_hour"], hour) / 3.6
    wait = _by_hour(EST["pickup_wait_min_by_hour"], hour) * 60
    out = {"wait_sec": wait.astype(int)}
    for tag, k in (("", EST["detour"]), ("_lo", EST["detour_low"]), ("_hi", EST["detour_high"])):
        d = straight_m * k
        drive = d / speed
        out["dist_m" + tag] = d.round().astype(int)
        out["drive_sec" + tag] = drive.round().astype(int)
        out["fare" + tag] = taxi_fare(d, drive, np.asarray(start_sec) + wait)
    return out


def bus_base(name):
    if name.startswith("N"):
        return TRANSIT["bus_night"]
    if any("가" <= c <= "힣" for c in name):      # 마포05처럼 한글이 들어간 번호 = 마을버스
        return TRANSIT["bus_village"]
    if len(name) == 4 and name.startswith("9"):
        return TRANSIT["bus_express"]
    return TRANSIT["bus_trunk_branch"]


def transit_fare(legs):
    """통합환승: 탄 것 중 가장 비싼 기본요금 + 전체 거리 10km 초과분 5km마다 100원 (50km 넘으면 8km마다)."""
    rides = [l for l in legs if l["type"] in ("rail", "bus")]
    if not rides:
        return 0
    base = max(TRANSIT["subway"] if l["type"] == "rail" else bus_base(l["line"]) for l in rides)
    km = sum(l.get("dist_m", 0) for l in rides) / 1000
    extra = 0
    if km > TRANSIT["base_distance_km"]:
        mid = min(km, TRANSIT["extra_until_km"]) - TRANSIT["base_distance_km"]
        extra += math.ceil(mid / 5) * TRANSIT["extra_per_5km"]
        if km > TRANSIT["extra_until_km"]:
            extra += math.ceil((km - TRANSIT["extra_until_km"]) / 8) * TRANSIT["extra_per_8km_after"]
    return int(base + extra)


def taxi_real(points, start_sec, live=False):
    """네이버 실제 경로로 택시 구간 다시 계산. points: [(lat, lng), ...]. 못 부르면 None.
    live=True면 네이버의 지금 교통 소요 시간을 쓰고, 아니면 거리 ÷ 그 시각대 속도로 시간을 구한다."""
    r = naver.route(points, need_fresh_duration=live)
    if r is None:
        return None
    hour = (int(start_sec) // 3600) % 24
    wait = int(_by_hour(EST["pickup_wait_min_by_hour"], np.array([hour]))[0] * 60)
    speed = float(_by_hour(EST["speed_kmh_by_hour"], np.array([hour]))[0]) / 3.6
    legs = []
    for d, t in r["legs"]:
        legs.append((d, t if (live and r["fresh"]) else d / speed))
    cum_d = np.cumsum([l[0] for l in legs])
    cum_t = np.cumsum([l[1] for l in legs])
    meters = taxi_fare(cum_d, cum_t, np.full(len(legs), start_sec + wait))
    fare = int(meters[-1])
    k = CFG["naver"]["real_fare_range"]
    rnd = TAXI["round_to"]
    return {"wait_sec": wait, "dist_m": int(cum_d[-1]), "drive_sec": int(round(cum_t[-1])), "fare": fare,
            "fare_lo": int(round(fare * (1 - k) / rnd) * rnd), "fare_hi": int(round(fare * (1 + k) / rnd) * rnd),
            "leg_dist_m": [int(x) for x in cum_d], "leg_drive_sec": [int(round(x)) for x in cum_t],
            "leg_meter": [int(x) for x in meters], "live": bool(live and r["fresh"])}

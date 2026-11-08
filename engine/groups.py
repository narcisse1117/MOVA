"""
모임 모드 (F3): 같은 방향끼리 택시 묶기 + 내리는 곳 기준 정산.

묶기 (절약량 병합, Clarke-Wright 방식)
  1. 처음엔 모두 혼자 탄다고 본다
  2. 두 묶음을 합쳤을 때 택시비가 가장 많이 줄어드는 쌍부터 합친다
  3. 한 차 MAX_PER_TAXI명까지, 혼자 갈 때보다 MAX_EXTRA_MIN분 넘게 늦어지는 사람이 생기면 합치지 않는다
  4. 내리는 순서는 가능한 순서를 모두 비교해서 택시비가 가장 싼 순서 (4명이면 24가지)

정산 (내리는 곳 기준)
  미터기는 한 번 켜고 끝까지 간다. 사람이 내릴 때마다 구간을 나누고, 구간 요금(그때 미터기 - 앞 구간 미터기)을
  그 구간에 타고 있던 사람끼리 똑같이 나눈다. 택시비는 마지막에 내리는 사람이 내고, 나머지는 그 사람에게 보낸다.

묶음을 고를 때는 fares.taxi_trip()과 같은 추정(직선거리 × 우회 계수, 시간대별 속도)을 쓰고,
묶음이 정해진 뒤 택시마다 네이버 실제 경로(경유지 포함, 1건)로 미터기·정산을 다시 계산한다.
혼자 탔을 때 요금(solo_fares)은 추정값이라 절약액은 참고용이다.
"""
import itertools
import math

import numpy as np

import fares
from network import to_xy

MAX_PER_TAXI = 4
MAX_EXTRA_MIN = 20
DROP_STOP_SEC = 60          # 한 사람 내려줄 때 서는 시간
SHARE_ROUND = 10            # 1인 몫은 10원 단위로 (남는 돈은 내는 사람이 부담)


def _route(start_xy, homes_xy, order, t_start):
    """정해진 순서로 내려줄 때 사람별 도착 시각과 내릴 때의 미터기 요금."""
    hour = int(t_start // 3600) % 24
    speed = fares.EST["speed_kmh_by_hour"].get(str(hour), fares.EST["speed_kmh_by_hour"]["default"]) / 3.6
    wait = fares.EST["pickup_wait_min_by_hour"].get(str(hour), fares.EST["pickup_wait_min_by_hour"]["default"]) * 60
    t, dist, drive, pos = t_start + wait, 0.0, 0.0, start_xy
    stops = []
    for k, i in enumerate(order):
        seg = float(np.linalg.norm(homes_xy[i] - pos)) * fares.EST["detour"]
        dist += seg
        drive += seg / speed
        meter = int(fares.taxi_fare(np.array([dist]), np.array([drive]), np.array([t_start + wait]))[0])
        stops.append({"member": i, "arrive": int(t + drive + k * DROP_STOP_SEC), "meter": meter, "dist_m": int(dist)})
        pos = homes_xy[i]
    return stops


def _best_order(start_xy, homes_xy, members, t_start):
    best = None
    for order in itertools.permutations(members):
        stops = _route(start_xy, homes_xy, order, t_start)
        if best is None or stops[-1]["meter"] < best[-1]["meter"]:
            best = stops
    return best


def settle(stops):
    """구간 요금을 그 구간에 탄 사람끼리 나눈다 → {member: 몫}."""
    share = {s["member"]: 0.0 for s in stops}
    prev = 0
    riders = [s["member"] for s in stops]
    for k, s in enumerate(stops):
        seg_cost = s["meter"] - prev
        on_board = riders[k:]
        for m in on_board:
            share[m] += seg_cost / len(on_board)
        prev = s["meter"]
    payer = stops[-1]["member"]
    out = {m: int(math.floor(v / SHARE_ROUND + 0.5) * SHARE_ROUND) for m, v in share.items()}
    out[payer] = int(round(stops[-1]["meter"])) - sum(v for m, v in out.items() if m != payer)
    return out, payer


def plan_taxis(meeting, homes, t_start, live=False):
    """meeting: (lat, lon), homes: [(lat, lon), ...], t_start: 운행일 기준 초.
    결과: 택시마다 내리는 순서·미터기·몫·누가 내는지. 혼자 탈 때와 비교한 절약액."""
    if not homes:
        return []
    sxy = to_xy([meeting[0]], [meeting[1]])[0]
    hxy = to_xy([h[0] for h in homes], [h[1] for h in homes])
    solo = {i: _route(sxy, hxy, (i,), t_start)[0] for i in range(len(homes))}

    groups = {i: {"members": (i,), "stops": [solo[i]]} for i in range(len(homes))}

    def ok(stops):
        return all(s["arrive"] - solo[s["member"]]["arrive"] <= MAX_EXTRA_MIN * 60 for s in stops)

    while True:
        best = None
        keys = list(groups)
        for a, b in itertools.combinations(keys, 2):
            ma, mb = groups[a]["members"], groups[b]["members"]
            if len(ma) + len(mb) > MAX_PER_TAXI:
                continue
            stops = _best_order(sxy, hxy, ma + mb, t_start)
            saving = groups[a]["stops"][-1]["meter"] + groups[b]["stops"][-1]["meter"] - stops[-1]["meter"]
            if saving > 0 and ok(stops) and (best is None or saving > best[0]):
                best = (saving, a, b, stops)
        if best is None:
            break
        _, a, b, stops = best
        groups[a] = {"members": groups[a]["members"] + groups[b]["members"], "stops": stops}
        del groups[b]

    taxis = []
    for g in groups.values():
        stops = g["stops"]
        # 묶음이 정해지면 네이버 실제 경로(경유지 포함)로 미터기를 다시 계산한다. 택시 한 대당 1건
        pts = [tuple(meeting)] + [tuple(homes[s["member"]]) for s in stops]
        r = fares.taxi_real(pts, t_start, live=live)
        source = "estimate"
        if r is not None:
            source = "naver_live" if r["live"] else "naver"
            stops = [dict(s, meter=r["leg_meter"][k], dist_m=r["leg_dist_m"][k],
                          arrive=int(t_start + r["wait_sec"] + r["leg_drive_sec"][k] + k * DROP_STOP_SEC))
                     for k, s in enumerate(stops)]
            for s in stops:
                if len(stops) == 1:
                    solo[s["member"]] = s
        shares, payer = settle(stops)
        taxis.append({
            "order": [s["member"] for s in stops],
            "stops": stops,
            "total_fare": stops[-1]["meter"],
            "payer": payer,
            "shares": shares,
            "solo_fares": {s["member"]: solo[s["member"]]["meter"] for s in stops},
            "source": source,
        })
    taxis.sort(key=lambda x: -len(x["order"]))
    return taxis


def settle_actual(est_meters, total_fare, actual_meters=None):
    """택시에서 내린 뒤 실제 금액으로 나눈다. 순서는 내린 순서.
    est_meters: 예상 미터기(내릴 때) 목록, total_fare: 실제 낸 총액,
    actual_meters: 사람마다 내릴 때 본 미터기 금액(있으면 이걸로 구간을 나눈다, 마지막 값은 total_fare로 맞춘다).
    결과: (몫 목록, 내는 사람 위치 = 마지막)."""
    n = len(est_meters)
    if n == 0:
        return [], None
    if actual_meters and len(actual_meters) == n and all(m is not None for m in actual_meters):
        meters = [float(m) for m in actual_meters]
        meters[-1] = float(total_fare)
    else:
        # 총액만 있으면 예상 미터기를 실제 총액 비율로 늘이거나 줄인다
        k = float(total_fare) / float(est_meters[-1]) if est_meters[-1] else 1.0
        meters = [m * k for m in est_meters]
        meters[-1] = float(total_fare)
    stops = [{"member": i, "meter": meters[i]} for i in range(n)]
    shares, payer = settle(stops)
    return [shares[i] for i in range(n)], payer

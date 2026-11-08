"""
RAPTOR: 출발 좌표·시각 → 도착 좌표까지 가장 빨리 도착하는 경로를 탈것 수(1~3)별로 구한다.

라운드 k = 대중교통을 k번 탄 상태. 라운드 사이에 같은 곳 갈아타기(역 180초, 정류장 30초)와
transfers.csv의 걷기 연결을 한 번 허용한다. 대중교통 환승 최대 2번 = MAX_LEGS 3.
"""
import numpy as np

import fares
from network import fmt, to_xy

INF = 2 ** 31 - 1
MAX_LEGS = 3
CHANGE_SEC = {"rail": 180, "bus": 30}   # 같은 역(place)·같은 정류장에서 다른 노선으로 갈아타는 시간
ACCESS_M = 800                          # 출발·도착에서 역·정류장까지 걸어갈 직선거리 한도
WALK_MPS = 1.1
DETOUR = 1.3
RAIL_EXIT_SEC = 120
MIN_GAIN_SEC = 300


def nearby(net, lat, lon, radius=ACCESS_M):
    """좌표 주변 역·정류장 → 걷는 초 (역은 승강장까지 시간을 더한다)."""
    xy = to_xy([lat], [lon])[0]
    best = {}
    for p in net.tree.query_ball_point(xy, radius):
        s = int(net.point_stop[p])
        d = float(np.linalg.norm(net.point_xy[p] - xy))
        w = int(np.ceil(d * DETOUR / WALK_MPS)) + (RAIL_EXIT_SEC if net.stop_kind[s] == "rail" else 0)
        if w < best.get(s, INF):
            best[s] = w
    return best


def query(net, origin, dest, t0, max_legs=MAX_LEGS, return_state=False):
    """origin, dest: (lat, lon). t0: 운행일 기준 초. 결과: 탈것 수가 적은 순으로 더 빨라지는 경로 목록."""
    n = len(net.stop_id)
    access = nearby(net, *origin)
    egress = nearby(net, *dest)

    arr = [np.full(n, INF, dtype=np.int64) for _ in range(max_legs + 1)]     # 라운드별 도착(탈것에서 내림)
    ready = [np.full(n, INF, dtype=np.int64) for _ in range(max_legs + 1)]   # 라운드별 탈 수 있는 시각
    p_arr = [dict() for _ in range(max_legs + 1)]
    p_ready = [dict() for _ in range(max_legs + 1)]
    best = np.full(n, INF, dtype=np.int64)   # 라운드와 상관없이 가장 이른 도착 (가지치기)
    target = INF
    for s, w in access.items():
        ready[0][s] = t0 + w
        p_ready[0][s] = ("access", w)
    marked = set(access)

    for k in range(1, max_legs + 1):
        # 표시된 정류장을 지나는 노선마다 가장 앞 위치부터 훑는다
        queue = {}
        for s in marked:
            for ri, pos in net.routes_at[s]:
                if pos < queue.get(ri, INF):
                    queue[ri] = pos
        newly = set()
        prev_ready, cur_arr = ready[k - 1], arr[k]
        for ri, start in queue.items():
            r = net.routes[ri]
            stops, A, D = r.stops, r.arr, r.dep
            trip, board = -1, -1
            for i in range(start, len(stops)):
                s = stops[i]
                if trip >= 0:
                    a = A[trip, i]
                    if a < best[s] and a < target:
                        cur_arr[s] = a
                        best[s] = a
                        p_arr[k][s] = (ri, trip, board, i)
                        newly.add(s)
                        if s in egress:
                            target = min(target, a + egress[s])
                rt = prev_ready[s]
                if rt < INF and (trip < 0 or rt <= D[trip, i]):
                    t = int(np.searchsorted(D[:, i], rt, side="left"))
                    # 막힌 운행(단축 운행으로 이 정류장을 안 지나는 운행)은 탈 수 없다
                    if t < len(D) and D[t, i] < INF and (trip < 0 or t < trip):
                        trip, board = t, i
        # 갈아타기: 같은 곳 + 걷기 연결
        nxt = ready[k]
        marked = set()
        for s in newly:
            a = cur_arr[s]
            c = a + CHANGE_SEC[net.stop_kind[s]]
            if c < nxt[s]:
                nxt[s] = c
                p_ready[k][s] = ("change", s)
                marked.add(s)
            for q, w in net.footpaths[s]:
                if a + w < nxt[q] and a + w < target:
                    nxt[q] = a + w
                    p_ready[k][q] = ("walk", s, w)
                    marked.add(q)
        if not marked:
            break

    # 탈것 수별 도착 → 더 적게 타고 같거나 빠른 게 있으면 뺀다
    results, best_total = [], INF
    for k in range(1, max_legs + 1):
        cand = [(arr[k][s] + w, s) for s, w in egress.items() if arr[k][s] < INF]
        if not cand:
            continue
        total, s = min(cand)
        # 한 번 더 갈아타는 경로는 MIN_GAIN_SEC 이상 빨라야 보여준다
        if total < best_total - (MIN_GAIN_SEC if results else 0):
            best_total = total
            results.append({"legs_count": k, "arrive": int(total),
                            "legs": reconstruct(net, k, s, p_arr, p_ready, arr, egress[s], t0)})
    if return_state:
        return results, {"arr": arr, "p_arr": p_arr, "p_ready": p_ready}
    return results


def stop_coords(net):
    """정류장 번호 → 평면 좌표 (역은 노선별 점 중 하나). 좌표가 없으면 nan."""
    if getattr(net, "_stop_xy", None) is None:
        xy = np.full((len(net.stop_id), 2), np.nan)
        xy[net.point_stop] = net.point_xy
        net._stop_xy = xy
    return net._stop_xy


def reconstruct(net, k, s, p_arr, p_ready, arr, egress_w, t0, last_leg=None):
    xy = stop_coords(net)
    legs = [last_leg or {"type": "walk", "to": "도착지", "sec": egress_w, "from": net.stop_name[s]}]
    while k > 0:
        ri, trip, b, a = p_arr[k][s]
        r = net.routes[ri]
        bs = int(r.stops[b])
        leg = {"type": r.kind, "line": r.name, "trip": r.trip_label[trip],
               "from": net.stop_name[bs], "dep": int(r.dep[trip, b]),
               "to": net.stop_name[s], "arr": int(r.arr[trip, a]), "stops": a - b}
        if r.kind == "bus":
            leg["headway_min"] = r.headway_min
        d = float(np.linalg.norm(xy[bs] - xy[s]))
        if not np.isnan(d):
            k_detour = fares.TRANSIT["rail_detour"] if r.kind == "rail" else fares.TRANSIT["bus_detour"]
            leg["dist_m"] = int(d * k_detour)
        legs.append(leg)
        pr = p_ready[k - 1][bs]
        if pr[0] == "access":
            legs.append({"type": "walk", "from": "출발지", "to": net.stop_name[bs], "sec": pr[1]})
            break
        if pr[0] == "walk":
            _, q, w = pr
            legs.append({"type": "walk", "from": net.stop_name[q], "to": net.stop_name[bs], "sec": w})
            s = q
        else:
            s = bs
        k -= 1
    return list(reversed(legs))


def describe(res, t0):
    lines = [f"탈것 {res['legs_count']}번, 도착 {fmt(res['arrive'])} (총 {(res['arrive'] - t0) // 60}분)"]
    for l in res["legs"]:
        if l["type"] == "walk":
            lines.append(f"  걷기 {l['from']} → {l['to']} {l['sec'] // 60}분 {l['sec'] % 60}초")
        else:
            extra = f", 배차 {l['headway_min']:.0f}분" if l["type"] == "bus" else ""
            lines.append(f"  {'지하철' if l['type'] == 'rail' else '버스'} {l['line']} [{l['trip']}{extra}] "
                         f"{l['from']} {fmt(l['dep'])} → {l['to']} {fmt(l['arr'])} ({l['stops']}정거장)")
    return "\n".join(lines)


def plan(net, origin, dest, t0, max_legs=MAX_LEGS):
    """F1·F2: 택시 직행 / 대중교통만 / 대중교통 + 마지막 택시 조합을 함께 낸다.

    조합: 대중교통으로 닿은 모든 역·정류장(라운드별)에서 도착지까지 택시를 탄다고 보고,
    택시비 + 시간 가치 × 걸린 시간이 가장 작은 곳을 추천한다. 도착 시각과 택시비가
    서로 나아지는 다른 후보(파레토) 중 가장 빠른 것·가장 싼 것도 같이 낸다.
    """
    transit, st = query(net, origin, dest, t0, max_legs, return_state=True)
    for r in transit:
        r["fare"] = fares.transit_fare(r["legs"])
    oxy, dxy = to_xy([origin[0]], [origin[1]])[0], to_xy([dest[0]], [dest[1]])[0]

    # 택시 직행
    tr = fares.taxi_trip(np.array([np.linalg.norm(oxy - dxy)]), np.array([t0]))
    direct = {"arrive": int(t0 + tr["wait_sec"][0] + tr["drive_sec"][0]), "fare": int(tr["fare"][0]),
              "fare_range": (int(tr["fare_lo"][0]), int(tr["fare_hi"][0])), "wait_sec": int(tr["wait_sec"][0]),
              "drive_sec": int(tr["drive_sec"][0]), "dist_m": int(tr["dist_m"][0])}

    # 조합 후보: 라운드 k에 내린 정류장 s에서 택시
    xy = stop_coords(net)
    is_rail = np.array([k == "rail" for k in net.stop_kind])
    cands = []
    for k in range(1, max_legs + 1):
        a = st["arr"][k]
        idx = np.flatnonzero((a < INF) & ~np.isnan(xy[:, 0]))
        if not len(idx):
            continue
        straight = np.linalg.norm(xy[idx] - dxy, axis=1)
        far = straight >= fares.EST["min_taxi_m"]
        idx, straight = idx[far], straight[far]
        if not len(idx):
            continue
        start = a[idx] + np.where(is_rail[idx], RAIL_EXIT_SEC, 0)
        t = fares.taxi_trip(straight, start)
        arrive = start + t["wait_sec"] + t["drive_sec"]
        for j in range(len(idx)):
            cands.append((int(arrive[j]), int(t["fare"][j]), k, int(idx[j]), int(start[j]),
                          {key: int(v[j]) for key, v in t.items()}))
    # 의미 있는 조합만: 택시 직행보다 충분히 싸고, 대중교통만보다 충분히 빨라야 한다
    save = max(fares.CFG["choice"]["min_saving_won"], direct["fare"] * fares.CFG["choice"]["min_saving_ratio"])
    fastest_transit = min((r["arrive"] for r in transit), default=INF)
    cands = [c for c in cands
             if c[1] + fares.TRANSIT["subway"] <= direct["fare"] - save and c[0] < fastest_transit - MIN_GAIN_SEC]
    combos = []
    if cands:
        def score(c):
            return c[1] + fares.VALUE_PER_MIN * (c[0] - t0) / 60

        pareto, best_fare = [], INF
        for c in sorted(cands, key=lambda c: (c[0], c[1])):
            if c[1] < best_fare - 500:          # 500원 넘게 싸질 때만 다른 후보로 본다
                pareto.append(c)
                best_fare = c[1]
        pick = min(cands, key=score)
        # 다른 안은 추천과 2,000원 또는 10분 넘게 달라야 보여준다
        others = [c for c in pareto if abs(c[1] - pick[1]) >= 2000 or abs(c[0] - pick[0]) >= 600]
        chosen = [pick] + others[:1] + others[-1:]   # 추천, 가장 빠른 것, 가장 싼 것
        seen = set()
        for c in chosen:
            if c[3] in seen:
                continue
            seen.add(c[3])
            arrive, fare, k, s, start, t = c
            leg = {"type": "taxi", "from": net.stop_name[s], "to": "도착지", "dep": start + t["wait_sec"],
                   "arr": arrive, "wait_sec": t["wait_sec"], "drive_sec": t["drive_sec"], "dist_m": t["dist_m"],
                   "fare": fare, "fare_range": (t["fare_lo"], t["fare_hi"])}
            legs = reconstruct(net, k, s, st["p_arr"], st["p_ready"], st["arr"], 0, t0, last_leg=leg)
            tf = fares.transit_fare(legs)
            combos.append({"legs_count": k, "arrive": arrive, "taxi_fare": fare, "transit_fare": tf,
                           "fare": fare + tf, "legs": legs, "recommended": c is pick})
    return {"t0": t0, "taxi_direct": direct, "transit": transit, "combo": combos}


def describe_leg(l):
    if l["type"] == "walk":
        return f"  걷기 {l['from']} → {l['to']} {l['sec'] // 60}분 {l['sec'] % 60}초"
    if l["type"] == "taxi":
        lo, hi = l["fare_range"]
        return (f"  택시 {l['from']} {fmt(l['dep'])} → {l['to']} {fmt(l['arr'])} "
                f"(호출 대기 {l['wait_sec'] // 60}분 뒤 출발, {l['dist_m'] / 1000:.1f}km, {l['fare']:,}원 / {lo:,}~{hi:,}원)")
    extra = f", 배차 {l['headway_min']:.0f}분" if l["type"] == "bus" else ""
    return (f"  {'지하철' if l['type'] == 'rail' else '버스'} {l['line']} [{l['trip']}{extra}] "
            f"{l['from']} {fmt(l['dep'])} → {l['to']} {fmt(l['arr'])} ({l['stops']}정거장)")


def describe_plan(p):
    t0, out = p["t0"], []
    d = p["taxi_direct"]
    out.append(f"[택시 직행] 도착 {fmt(d['arrive'])} (총 {(d['arrive'] - t0) // 60}분, 대기 {d['wait_sec'] // 60}분 포함) "
               f"{d['dist_m'] / 1000:.1f}km, {d['fare']:,}원 ({d['fare_range'][0]:,}~{d['fare_range'][1]:,}원)")
    if p["transit"]:
        for r in p["transit"]:
            out.append(f"[대중교통만] 탈것 {r['legs_count']}번, 도착 {fmt(r['arrive'])} "
                       f"(총 {(r['arrive'] - t0) // 60}분), {r['fare']:,}원")
            out += [describe_leg(l) for l in r["legs"]]
    else:
        out.append("[대중교통만] 갈 수 없음")
    for c in p["combo"]:
        tag = "조합 추천" if c["recommended"] else "조합 다른 안"
        out.append(f"[{tag}] 도착 {fmt(c['arrive'])} (총 {(c['arrive'] - t0) // 60}분), "
                   f"{c['fare']:,}원 (대중교통 {c['transit_fare']:,} + 택시 {c['taxi_fare']:,})")
        out += [describe_leg(l) for l in c["legs"]]
    return "\n".join(out)

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


def query(net, origin, dest, t0, max_legs=MAX_LEGS, return_state=False, skip_routes=None, extra_access=None):
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
    # 처음 구간 택시: {정류장: (탈 수 있는 시각, 택시 구간 정보)}
    for s, (rt, leg) in (extra_access or {}).items():
        if rt < ready[0][s]:
            ready[0][s] = rt
            p_ready[0][s] = ("taxi", leg)
            marked.add(s)

    for k in range(1, max_legs + 1):
        # 표시된 정류장을 지나는 노선마다 가장 앞 위치부터 훑는다
        queue = {}
        for s in marked:
            for ri, pos in net.routes_at[s]:
                if skip_routes is not None and ri in skip_routes:
                    continue
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
                    # 공식 시각인 첫·막 운행은 그대로, 가상 운행은 board_slack만큼 일찍 와 있어야 탄다
                    n_trips = len(D)
                    if r.exact_first and D[0, i] >= rt:
                        t = 0
                    else:
                        t = int(np.searchsorted(D[:, i], rt + r.board_slack, side="left"))
                        if r.exact_last and t >= n_trips - 1 and D[n_trips - 1, i] >= rt:
                            t = n_trips - 1
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
            leg["route_id"] = r.route_id
            leg["board_stop_id"] = net.stop_id[bs]
            if r.stop_seq is not None:
                leg["board_seq"] = int(r.stop_seq[b])
        d = float(np.linalg.norm(xy[bs] - xy[s]))
        if not np.isnan(d):
            k_detour = fares.TRANSIT["rail_detour"] if r.kind == "rail" else fares.TRANSIT["bus_detour"]
            leg["dist_m"] = int(d * k_detour)
        legs.append(leg)
        pr = p_ready[k - 1][bs]
        if pr[0] == "taxi":
            legs.append(dict(pr[1], to=net.stop_name[bs]))
            break
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


FIRST_TAXI_CAPS = [7000, 10000, 14000, 20000]   # 처음 구간 택시비 상한별로 따로 찾는다
FIRST_TAXI_MIN_M, FIRST_TAXI_MAX_M = 1000, 15000
FIRST_TAXI_BUFFER_SEC = 180     # 택시에서 내려 열차를 탈 때 여유 (호출 대기·교통이 들쭉날쭉하다)


def stop_ll(net):
    """정류장 번호 → (위도, 경도). to_xy의 역변환."""
    if getattr(net, "_stop_ll", None) is None:
        import math
        from network import LAT0, R_EARTH
        xy = stop_coords(net)
        lat = np.degrees(xy[:, 1] / R_EARTH)
        lon = np.degrees(xy[:, 0] / (R_EARTH * math.cos(LAT0)))
        net._stop_ll = np.column_stack([lat, lon])
    return net._stop_ll


def _taxi_leg(frm, to, start, t, i=None, from_ll=None, to_ll=None):
    g = (lambda k: int(t[k][i])) if i is not None else (lambda k: int(t[k]))
    return {"type": "taxi", "from": frm, "to": to, "dep": start + g("wait_sec"), "start": start,
            "from_ll": tuple(map(float, from_ll)) if from_ll is not None else None,
            "to_ll": tuple(map(float, to_ll)) if to_ll is not None else None, "source": "estimate",
            "arr": start + g("wait_sec") + g("drive_sec"), "wait_sec": g("wait_sec"), "drive_sec": g("drive_sec"),
            "dist_m": g("dist_m"), "fare": g("fare"), "fare_range": (g("fare_lo"), g("fare_hi"))}


def first_taxi_access(net, origin, t0, cap):
    """출발지에서 택시로 갈 지하철역 후보 (택시비 cap원 이하) → query()의 extra_access."""
    xy = stop_coords(net)
    oxy = to_xy([origin[0]], [origin[1]])[0]
    rail = np.flatnonzero(np.array([k == "rail" for k in net.stop_kind]) & ~np.isnan(xy[:, 0]))
    d = np.linalg.norm(xy[rail] - oxy, axis=1)
    m = (d >= FIRST_TAXI_MIN_M) & (d <= FIRST_TAXI_MAX_M)
    rail, d = rail[m], d[m]
    if not len(rail):
        return {}
    t = fares.taxi_trip(d, np.full(len(d), t0))
    out = {}
    for i in np.flatnonzero(t["fare"] <= cap):
        leg = _taxi_leg("출발지", net.stop_name[rail[i]], t0, t, i, from_ll=origin, to_ll=stop_ll(net)[rail[i]])
        out[int(rail[i])] = (leg["arr"] + RAIL_EXIT_SEC + FIRST_TAXI_BUFFER_SEC, leg)
    return out


def _options_from_search(net, dest, t0, transit, st, max_legs):  # noqa: C901
    """한 번의 탐색 결과 → 후보 (대중교통으로 끝까지 + 마지막 택시)."""
    opts = []
    for r in transit:
        opts.append(dict(r))
    dxy = to_xy([dest[0]], [dest[1]])[0]
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
            cands.append((int(arrive[j]), int(t["fare"][j]), k, int(idx[j]), int(start[j]), t, j))
    if not cands:
        return opts
    # 마지막 택시 후보는 많으니, 마지막 택시비 기준 점수·파레토로 몇 개만 골라 경로를 복원한다
    def score(c):
        return c[1] + fares.VALUE_PER_MIN * (c[0] - t0) / 60
    pareto, best_fare = [], INF
    for c in sorted(cands, key=lambda c: (c[0], c[1])):
        if c[1] < best_fare - 500:
            pareto.append(c)
            best_fare = c[1]
    picks = sorted(cands, key=score)[:3] + pareto[:2] + pareto[-2:]
    seen = set()
    for arrive, fare, k, s, start, t, j in picks:
        if (k, s) in seen:
            continue
        seen.add((k, s))
        leg = _taxi_leg(net.stop_name[s], "도착지", start, t, j, from_ll=stop_ll(net)[s], to_ll=dest)
        legs = reconstruct(net, k, s, st["p_arr"], st["p_ready"], st["arr"], 0, t0, last_leg=leg)
        opts.append({"legs_count": k, "arrive": arrive, "legs": legs})
    return opts


def _price(opt):
    taxi = sum(l["fare"] for l in opt["legs"] if l["type"] == "taxi")
    tf = fares.transit_fare(opt["legs"])
    first = opt["legs"][0]["type"] == "taxi"
    last = opt["legs"][-1]["type"] == "taxi"
    kind = {(False, False): "transit", (True, False): "taxi_first", (False, True): "taxi_last",
            (True, True): "taxi_both"}[(first, last)]
    return dict(opt, taxi_fare=taxi, transit_fare=tf, fare=taxi + tf, combo_kind=kind)


def refine_taxi_leg(leg, live):
    """택시 구간을 네이버 실제 경로로 다시 계산 (제자리에서 바꿈). 성공하면 True."""
    if not leg.get("from_ll") or not leg.get("to_ll"):
        return False
    r = fares.taxi_real([leg["from_ll"], leg["to_ll"]], leg["start"], live=live)
    if r is None:
        return False
    leg.update(wait_sec=r["wait_sec"], dep=leg["start"] + r["wait_sec"], arr=leg["start"] + r["wait_sec"] + r["drive_sec"],
               drive_sec=r["drive_sec"], dist_m=r["dist_m"], fare=r["fare"], fare_range=(r["fare_lo"], r["fare_hi"]),
               source="naver_live" if r["live"] else "naver")
    return True


def _refine_option(o, live):
    """조합 하나의 택시 구간을 실제 경로로. 처음 택시가 늦어져 다음 열차를 놓치면 None."""
    legs = [dict(l) for l in o["legs"]]
    for i, l in enumerate(legs):
        if l["type"] != "taxi":
            continue
        refine_taxi_leg(l, live)
        if i == 0 and len(legs) > 1:
            nxt = next((x for x in legs[1:] if x["type"] in ("rail", "bus")), None)
            if nxt is not None and l["arr"] + RAIL_EXIT_SEC + FIRST_TAXI_BUFFER_SEC > nxt["dep"]:
                return None
    arrive = legs[-1]["arr"] if legs[-1]["type"] == "taxi" else o["arrive"]
    return _price(dict(o, legs=legs, arrive=arrive))


def plan(net, origin, dest, t0, max_legs=MAX_LEGS, live=False):
    """F1·F2: 택시 직행 / 대중교통만 / 대중교통 + 택시 조합을 함께 낸다.

    조합은 세 가지: 마지막 구간 택시(대중교통으로 근처까지), 처음 구간 택시(택시로 막차가 남은 역까지),
    양쪽 다 택시. 처음 구간 택시는 택시비 상한(FIRST_TAXI_CAPS)마다 따로 탐색한다. 탐색은 가장 빨리
    도착하는 경로만 찾으므로, 상한이 없으면 늘 택시를 멀리 타는 경로만 나오기 때문이다.
    추천: 총요금 + 시간 가치 × 걸린 시간이 가장 작은 조합. 다른 안: 파레토 후보 중 가장 빠른 것·가장 싼 것.
    """
    transit, st = query(net, origin, dest, t0, max_legs, return_state=True)
    for r in transit:
        r["fare"] = fares.transit_fare(r["legs"])
    oxy, dxy = to_xy([origin[0]], [origin[1]])[0], to_xy([dest[0]], [dest[1]])[0]

    tr = fares.taxi_trip(np.array([np.linalg.norm(oxy - dxy)]), np.array([t0]))
    direct = {"arrive": int(t0 + tr["wait_sec"][0] + tr["drive_sec"][0]), "fare": int(tr["fare"][0]),
              "fare_range": (int(tr["fare_lo"][0]), int(tr["fare_hi"][0])), "wait_sec": int(tr["wait_sec"][0]),
              "drive_sec": int(tr["drive_sec"][0]), "dist_m": int(tr["dist_m"][0]), "source": "estimate"}
    leg = {"from_ll": tuple(origin), "to_ll": tuple(dest), "start": t0}
    if refine_taxi_leg(leg, live):
        direct.update(arrive=leg["arr"], fare=leg["fare"], fare_range=leg["fare_range"], wait_sec=leg["wait_sec"],
                      drive_sec=leg["drive_sec"], dist_m=leg["dist_m"], source=leg["source"])

    opts = _options_from_search(net, dest, t0, [], st, max_legs)
    for cap in FIRST_TAXI_CAPS:
        if cap >= direct["fare"]:
            break
        acc = first_taxi_access(net, origin, t0, cap)
        if not acc:
            continue
        res, st2 = query(net, origin, dest, t0, max_legs, return_state=True, extra_access=acc)
        opts += _options_from_search(net, dest, t0, res, st2, max_legs)
    opts = [o for o in (_price(o) for o in opts) if o["combo_kind"] != "transit"]

    # 의미 있는 조합만: 택시 직행보다 충분히 싸고, 대중교통만보다 충분히 빨라야 한다
    save = max(fares.CFG["choice"]["min_saving_won"], direct["fare"] * fares.CFG["choice"]["min_saving_ratio"])
    fastest_transit = min((r["arrive"] for r in transit), default=INF)
    opts = [o for o in opts if o["fare"] <= direct["fare"] - save and o["arrive"] < fastest_transit - MIN_GAIN_SEC]
    combos = []
    if opts:
        def score(o):
            return o["fare"] + fares.VALUE_PER_MIN * (o["arrive"] - t0) / 60
        pick = min(opts, key=score)
        pareto, best_fare = [], INF
        for o in sorted(opts, key=lambda o: (o["arrive"], o["fare"])):
            if o["fare"] < best_fare - 500:
                pareto.append(o)
                best_fare = o["fare"]
        # 다른 안은 추천과 2,000원 또는 10분 넘게 달라야 보여준다
        others = [o for o in pareto if abs(o["fare"] - pick["fare"]) >= 2000 or abs(o["arrive"] - pick["arrive"]) >= 600]
        chosen = [pick] + others[:1] + others[-1:]
        # 고른 것만 네이버 실제 경로로 다시 계산한다 (호출 수 절약). 추천도 실제 값으로 다시 고른다
        refined, seen = [], set()
        for o in chosen + [x for x in sorted(opts, key=score) if x not in chosen][:2]:
            key = (o["arrive"], o["fare"])
            if key in seen:
                continue
            seen.add(key)
            r = _refine_option(o, live)
            if r is not None and r["fare"] <= direct["fare"] - save and r["arrive"] < fastest_transit - MIN_GAIN_SEC:
                refined.append(r)
        if refined:
            best = min(refined, key=score)
            rest = sorted([r for r in refined if r is not best], key=lambda r: r["arrive"])
            keep = [best] + [r for r in rest if abs(r["fare"] - best["fare"]) >= 2000
                             or abs(r["arrive"] - best["arrive"]) >= 600][:2]
            combos = [dict(r, recommended=r is best) for r in keep]
    return {"t0": t0, "taxi_direct": direct, "transit": transit, "combo": combos}


def describe_leg(l):
    if l["type"] == "walk":
        return f"  걷기 {l['from']} → {l['to']} {l['sec'] // 60}분 {l['sec'] % 60}초"
    if l["type"] == "taxi":
        lo, hi = l["fare_range"]
        src = {"naver": " [네이버 경로]", "naver_live": " [네이버 실시간]"}.get(l.get("source"), " [추정]")
        return (f"  택시{src} {l['from']} {fmt(l['dep'])} → {l['to']} {fmt(l['arr'])} "
                f"(호출 대기 {l['wait_sec'] // 60}분 뒤 출발, {l['dist_m'] / 1000:.1f}km, {l['fare']:,}원 / {lo:,}~{hi:,}원)")
    extra = f", 배차 {l['headway_min']:.0f}분" if l["type"] == "bus" else ""
    rt = ""
    if l.get("realtime"):
        x = l["realtime"]
        if x["status"] in ("ok", "later", "earlier"):
            rt = (f"  ← 실시간 {x['arrive_in_sec'] // 60}분 {x['arrive_in_sec'] % 60}초 뒤 ({fmt(x['realtime_dep'])})"
                  f"{' 막차' if x['is_last'] else ''}, 예정보다 {x['delay_sec'] // 60:+d}분 [{x['status']}]")
        else:
            rt = f"  ← 실시간 [{x['status']}] {x.get('message', '')}"
    return (f"  {'지하철' if l['type'] == 'rail' else '버스'} {l['line']} [{l['trip']}{extra}] "
            f"{l['from']} {fmt(l['dep'])} → {l['to']} {fmt(l['arr'])} ({l['stops']}정거장){rt}")


def describe_plan(p):
    t0, out = p["t0"], []
    d = p["taxi_direct"]
    src = {"naver": " 네이버 경로", "naver_live": " 네이버 실시간"}.get(d.get("source"), " 추정")
    out.append(f"[택시 직행{src}] 도착 {fmt(d['arrive'])} (총 {(d['arrive'] - t0) // 60}분, 대기 {d['wait_sec'] // 60}분 포함) "
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
        kind = {"taxi_first": "처음 택시", "taxi_last": "마지막 택시", "taxi_both": "양쪽 택시"}[c["combo_kind"]]
        out.append(f"[{tag} · {kind}] 도착 {fmt(c['arrive'])} (총 {(c['arrive'] - t0) // 60}분), "
                   f"{c['fare']:,}원 (대중교통 {c['transit_fare']:,} + 택시 {c['taxi_fare']:,})")
        out += [describe_leg(l) for l in c["legs"]]
    return "\n".join(out)

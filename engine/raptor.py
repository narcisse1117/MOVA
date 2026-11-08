"""
RAPTOR: 출발 좌표·시각 → 도착 좌표까지 가장 빨리 도착하는 경로를 탈것 수(1~3)별로 구한다.

라운드 k = 대중교통을 k번 탄 상태. 라운드 사이에 같은 곳 갈아타기(역 180초, 정류장 30초)와
transfers.csv의 걷기 연결을 한 번 허용한다. 대중교통 환승 최대 2번 = MAX_LEGS 3.
"""
import numpy as np

from network import fmt, to_xy

INF = 2 ** 31 - 1
MAX_LEGS = 3
CHANGE_SEC = {"rail": 180, "bus": 30}   # 같은 역(place)·같은 정류장에서 다른 노선으로 갈아타는 시간
ACCESS_M = 800                          # 출발·도착에서 역·정류장까지 걸어갈 직선거리 한도
WALK_MPS = 1.1
DETOUR = 1.3
RAIL_EXIT_SEC = 120


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


def query(net, origin, dest, t0, max_legs=MAX_LEGS):
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
                    if t < len(D) and (trip < 0 or t < trip):
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
        if total < best_total:
            best_total = total
            results.append({"legs_count": k, "arrive": int(total),
                            "legs": reconstruct(net, k, s, p_arr, p_ready, arr, egress[s], t0)})
    return results


def reconstruct(net, k, s, p_arr, p_ready, arr, egress_w, t0):
    legs = [{"type": "walk", "to": "도착지", "sec": egress_w, "from": net.stop_name[s]}]
    while k > 0:
        ri, trip, b, a = p_arr[k][s]
        r = net.routes[ri]
        bs = int(r.stops[b])
        leg = {"type": r.kind, "line": r.name, "trip": r.trip_label[trip],
               "from": net.stop_name[bs], "dep": int(r.dep[trip, b]),
               "to": net.stop_name[s], "arr": int(r.arr[trip, a]), "stops": a - b}
        if r.kind == "bus":
            leg["headway_min"] = r.headway_min
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

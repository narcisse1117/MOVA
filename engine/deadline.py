"""
출발 마감 시각 (F3 모임 모드): "몇 시까지 출발하면 대중교통으로 집에 갈 수 있나".

늦게 출발할수록 갈 수 있는 경로는 줄어들기만 한다 (기다리면 같은 차를 탈 수 있으므로).
그래서 출발 시각을 이분 탐색해서 '대중교통으로 갈 수 있는 가장 늦은 출발'을 찾는다.
RAPTOR 한 번이 0.3초쯤이라 10번 안팎이면 3초 정도 걸린다. 느리면 역방향 RAPTOR로 바꾼다.

두 가지를 낸다:
  regular: 지하철 + 일반 버스만 (심야버스 제외). 보통 말하는 '막차 시각'
  night:   심야버스(N)까지 포함. 단, 걸리는 시간이 MAX_DURATION_MIN 이하인 경로만 인정
"""
import raptor
from network import fmt

MAX_DURATION_MIN = 150      # 이보다 오래 걸리는 경로는 '갈 수 있다'로 치지 않는다
BUFFER_MIN = 5              # 안내할 때 마감보다 이만큼 앞당긴다 (버스 도착 오차, 계산대 앞 줄 등)
STEP_SEC = 60
SEARCH_END = 28 * 3600      # 04:00 (운행일 기준)


def night_routes(net):
    return {i for i, r in enumerate(net.routes) if r.kind == "bus" and r.name.startswith("N")}


def _best(net, origin, dest, t0, skip, max_dur_sec):
    res = raptor.query(net, origin, dest, t0, skip_routes=skip)
    ok = [r for r in res if max_dur_sec is None or r["arrive"] - t0 <= max_dur_sec]
    return min(ok, key=lambda r: r["arrive"]) if ok else None


def latest_departure(net, origin, dest, t_from, skip=None, max_dur_sec=None, t_to=SEARCH_END):
    """t_from~t_to 사이에서 경로가 있는 가장 늦은 출발 시각과 그 경로. t_from에도 없으면 None."""
    first = _best(net, origin, dest, t_from, skip, max_dur_sec)
    if first is None:
        return None, None
    last_ok = _best(net, origin, dest, t_to, skip, max_dur_sec)
    if last_ok is not None:
        return t_to, last_ok          # 검색 끝까지 갈 수 있음
    lo, hi, best = t_from, t_to, first
    while hi - lo > STEP_SEC:
        mid = (lo + hi) // 2
        r = _best(net, origin, dest, mid, skip, max_dur_sec)
        if r is not None:
            lo, best = mid, r
        else:
            hi = mid
    return lo, best


def deadlines(net, origin, dest, t_from):
    nr = night_routes(net)
    t_reg, r_reg = latest_departure(net, origin, dest, t_from, skip=nr)
    t_any, r_any = latest_departure(net, origin, dest, t_from, max_dur_sec=MAX_DURATION_MIN * 60)
    out = {"from": t_from,
           "regular": None if t_reg is None else {"latest": t_reg, "leave_by": t_reg - BUFFER_MIN * 60, "route": r_reg},
           "night": None if t_any is None else {"latest": t_any, "leave_by": t_any - BUFFER_MIN * 60, "route": r_any,
                                                "all_night": t_any >= SEARCH_END}}
    return out


def describe(d):
    lines = []
    for key, title in (("regular", "지하철·일반버스 막차 기준"), ("night", f"심야버스 포함 ({MAX_DURATION_MIN}분 이내 경로)")):
        v = d[key]
        if v is None:
            lines.append(f"[{title}] {fmt(d['from'])}부터는 갈 수 없음")
            continue
        if v.get("all_night"):
            lines.append(f"[{title}] 04:00까지 계속 갈 수 있음")
        else:
            lines.append(f"[{title}] {fmt(v['leave_by'])}까지 출발 권장 (마지막 가능 {fmt(v['latest'])})")
        r = v["route"]
        lines.append(f"  마지막 경로: 도착 {fmt(r['arrive'])}, 탈것 {r['legs_count']}번")
        lines += [raptor.describe_leg(l) for l in r["legs"]]
    return "\n".join(lines)

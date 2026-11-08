"""
prep/out/의 지하철·버스·환승 표를 RAPTOR가 쓰는 노선망으로 만든다.

- 지하철: 정차 순서(place_id 나열)가 같은 열차끼리 한 노선(route)으로 묶는다
- 버스: 시각표가 없으므로 기점 막차 시각에서 배차 간격만큼 거슬러 올라가며 가상 운행을 만든다.
  정류장별 시각은 출발 시각대의 구간 운행시간(중앙값)을 차례로 더해 구한다. 막차 시각은 정확히 맞는다
- 운행일 유형(WD/SAT/HOL)마다 따로 만들고 engine/cache/에 저장한다

시각은 모두 운행일 기준 초 (자정 이후 86400 초과).
"""
import glob
import math
import os
import pickle
from collections import defaultdict
from dataclasses import dataclass, field

import datetime as dt

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

ENGINE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ENGINE)
PREP_OUT = os.path.join(ROOT, "prep", "out")
CACHE = os.path.join(ENGINE, "cache")
CACHE_VERSION = 10
DATA = os.path.join(ROOT, "데이터")
OFFICIAL_BLEND_SEC = 7200
OUTLIER_SEC = 1800
SHORT_TURN_SLACK = 180     # 공식 막차보다 이만큼 늦게 지나는 운행은 없는 것으로 본다
INF32 = 2 ** 31 - 1
BUS_BOARD_SLACK_RATIO = 0.5   # 버스 가상 운행은 실제와 배차 간격만큼 어긋날 수 있어, 평균 대기(절반)만큼 일찍 와 있어야 탄다고 본다         # 공식 정류장 시각이 추정 기점 시각에서 이만큼 벗어나면 버린다   # 공식 막차·첫차에서 이 시간 안의 버스는 공식 시각 쪽으로 보정한다

RAIL_QUALITY_OK = {"ok", "dep_from_arr"}
BUS_DAY = {"WD": ("WD", "wd"), "SAT": ("SAT", "we"), "HOL": ("HOL", "we")}

R_EARTH = 6371000.0
LAT0 = math.radians(37.55)


def to_xy(lat, lon):
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    return np.column_stack([np.radians(lon) * R_EARTH * math.cos(LAT0), np.radians(lat) * R_EARTH])


@dataclass
class Route:
    kind: str                 # rail / bus
    name: str                 # 화면용 (예: '2호선', '143')
    stops: np.ndarray         # 정류장 번호 (Network.stop_*)
    arr: np.ndarray           # [운행, 정류장] 도착 시각
    dep: np.ndarray           # [운행, 정류장] 출발 시각 (열마다 오름차순)
    trip_label: list          # 운행마다 설명 (열차번호·행선지 / 기점 출발 시각)
    headway_min: float = 0.0  # 버스만
    route_id: str = ""
    board_slack: int = 0      # 가상 운행을 타려면 이만큼 일찍 정류장에 있어야 한다 (버스: 배차 간격의 절반)
    exact_first: bool = False # 첫 운행이 공식 시각 (여유 없이 탈 수 있음)
    exact_last: bool = False  # 마지막 운행이 공식 시각
    stop_seq: np.ndarray = None  # 버스: 정류장마다 노선 순서 번호 (실시간 API의 ord)


@dataclass
class Network:
    day: str
    stop_kind: list = field(default_factory=list)   # rail / bus
    stop_id: list = field(default_factory=list)     # place_id / stop_id
    stop_name: list = field(default_factory=list)
    routes: list = field(default_factory=list)
    routes_at: list = field(default_factory=list)   # 정류장 → [(route 번호, 위치)]
    footpaths: list = field(default_factory=list)   # 정류장 → [(정류장, 걷는 초)]
    point_stop: np.ndarray = None                   # 좌표 점 → 정류장 (역은 노선마다 점이 따로 있음)
    point_xy: np.ndarray = None
    tree: cKDTree = None
    index: dict = field(default_factory=dict)       # (kind, id) → 정류장 번호

    def add_stop(self, kind, sid, name):
        key = (kind, sid)
        if key not in self.index:
            self.index[key] = len(self.stop_id)
            self.stop_kind.append(kind)
            self.stop_id.append(sid)
            self.stop_name.append(name)
        return self.index[key]


def split_fifo(dep):
    """행(운행)을 출발 순으로 정렬한 뒤, 앞지르기가 있으면 앞지르기 없는 묶음으로 나눈다."""
    order = np.argsort(dep[:, 0], kind="stable")
    groups = []
    for t in order:
        for g in groups:
            if np.all(dep[t] >= dep[g[-1]]):
                g.append(t)
                break
        else:
            groups.append([t])
    return groups


def chain_loops(trips, max_wait=180):
    """순환선(2호선)은 성수에서 한 바퀴 단위로 운행이 끊겨 있다. 실제로는 번호만 바뀌고 계속 도므로,
    출발역 = 도착역인 운행에 같은 역에서 같은 방향(바로 다음 역이 다른 쪽)으로 max_wait초 안에 출발하는
    운행을 이어 붙인다. 이어 붙인 운행은 원래 운행과 별도로 추가한다."""
    starts = defaultdict(list)   # (노선, 출발 장소) → [(출발 시각, 둘째 장소, trip_id)]
    for tid, (line, places, a, d, _) in trips.items():
        if len(places) > 2:
            starts[(line, places[0])].append((d[0], places[1], tid))
    for v in starts.values():
        v.sort()
    used, out = set(), dict(trips)
    for tid, (line, places, a, d, label) in trips.items():
        if len(places) < 3 or places[0] != places[-1]:
            continue
        came_from, t_end = places[-2], a[-1]
        for t0, second, nid in starts.get((line, places[-1]), []):
            if t_end <= t0 <= t_end + max_wait and second != came_from and nid not in used:
                used.add(nid)
                _, p2, a2, d2, l2 = trips[nid]
                d_join = d.copy()
                d_join[-1] = d2[0]
                out[tid + "+" + nid] = (line, np.concatenate([places, p2[1:]]), np.concatenate([a, a2[1:]]),
                                        np.concatenate([d_join, d2[1:]]), label + "→" + l2.split(" ")[0])
                break
    return out


def load_rail(net, day):
    st = pd.read_csv(os.path.join(PREP_OUT, "stations.csv"), dtype={"place_id": str, "code": str})
    fix = pd.read_csv(os.path.join(ROOT, "prep", "manual_coords.csv"), dtype={"code": str})
    for f in fix.itertuples():
        m = (st.code == f.code) & (st.name == f.name)
        st.loc[m, ["lat", "lng"]] = [f.lat, f.lng]
        st.loc[m, "coord_suspect"] = False

    s = pd.read_csv(os.path.join(PREP_OUT, "stop_times.csv"),
                    dtype={"place_id": str, "train": str, "trip_id": str}, low_memory=False)
    s = s[s.service_days.str.split(",").apply(lambda d: day in d) & s.quality.isin(RAIL_QUALITY_OK)]
    s = s.sort_values(["trip_id", "seq"])

    place_name = st.drop_duplicates("place_id").set_index("place_id").name
    pts = st[st.place_id.isin(set(s.place_id)) & ~st.coord_suspect]

    trips = {}
    for tid, g in s.groupby("trip_id", sort=False):
        label = f"{g.train.iloc[0]} {g.terminus.iloc[0]}행" + (f"({g.type.iloc[0]})" if g.type.iloc[0] != "일반" else "")
        trips[tid] = (g.line.iloc[0], g.place_id.to_numpy(), g.arr_sec.to_numpy(), g.dep_sec.to_numpy(), label)
    trips = chain_loops(trips)

    patterns = defaultdict(list)
    for line, places, a, d, label in trips.values():
        patterns[(line, tuple(places))].append((a, d, label))
    for (line, places), trips in patterns.items():
        stops = np.array([net.add_stop("rail", p, place_name.get(p, p)) for p in places], dtype=np.int32)
        arr = np.array([t[0] for t in trips], dtype=np.int32)
        dep = np.array([t[1] for t in trips], dtype=np.int32)
        dep = np.maximum(dep, arr)
        labels = [t[2] for t in trips]
        short = line.replace("서울 도시철도 ", "").replace("수도권 경량도시철도 ", "").replace("수도권 광역철도 ", "")
        for g in split_fifo(dep):
            net.routes.append(Route("rail", short, stops, arr[g], dep[g], [labels[i] for i in g]))
    return pts


def official_file(day):
    files = sorted(glob.glob(os.path.join(DATA, f"bus_stop_times_*_{day}.csv")))
    return files[-1] if files else None


def load_official(day):
    """fetch_bus_times.py가 받은 정류장별 첫차·막차 → {route_id: {seq: (첫차, 막차)}} (운행일 기준 초)."""
    path = official_file(day)
    if not path:
        return {}, None
    b = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    base = dt.datetime.strptime(os.path.basename(path).split("_")[3], "%Y%m%d")

    def sec(v):
        if not isinstance(v, str) or len(v.strip()) != 14:
            return np.nan
        t = dt.datetime.strptime(v.strip(), "%Y%m%d%H%M%S")
        return (t - base).total_seconds()

    b["f"], b["l"] = b.first_tm.map(sec), b.last_tm.map(sec)
    b["seq"] = pd.to_numeric(b.sta_ord, errors="coerce")
    out = defaultdict(dict)
    for rid, sq, st, f, l in zip(b.route_id, b.seq, b.st_id, b.f, b.l):
        out[rid][int(sq)] = (st, f, l)
    return out, os.path.basename(path)


def clean_monotone(vals, slack=120):
    """정류장 순서대로 시각이 늘어나야 한다. 순서가 맞는 값을 가장 많이 남기고(최장 증가 부분수열,
    slack초 역행은 허용) 나머지는 튀는 값으로 보고 비운다."""
    v = vals.astype(float).copy()
    idx = np.flatnonzero(~np.isnan(v))
    if len(idx) < 2:
        return v
    x = v[idx]
    n = len(x)
    best = np.ones(n, dtype=int)
    prev = np.full(n, -1)
    for i in range(1, n):
        ok = np.flatnonzero(x[:i] <= x[i] + slack)
        if len(ok):
            j = ok[np.argmax(best[ok])]
            if best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    keep = set()
    i = int(np.argmax(best))
    while i >= 0:
        keep.add(i)
        i = prev[i]
    for k in range(n):
        if k not in keep:
            v[idx[k]] = np.nan
    return v


def fill_along(vals):
    """정류장 순서를 따라 빈 보정값을 앞뒤 값으로 선형 보간한다."""
    idx = np.arange(len(vals))
    ok = ~np.isnan(vals)
    if not ok.any():
        return np.zeros(len(vals))
    return np.interp(idx, idx[ok], vals[ok])


def load_bus(net, day):
    code, seg_day = BUS_DAY[day]
    official, official_name = load_official(day)
    net.bus_official = official_name
    n_official = 0
    n_short_turn = [0]
    routes = pd.read_csv(os.path.join(PREP_OUT, "bus_routes.csv"), dtype={"route_id": str, "route_no": str})
    rs = pd.read_csv(os.path.join(PREP_OUT, "bus_route_stops.csv"), dtype={"route_id": str, "stop_id": str})
    seg = pd.read_csv(os.path.join(PREP_OUT, "bus_segments.csv"), dtype={"route_id": str, "stop_id": str})
    stops = pd.read_csv(os.path.join(PREP_OUT, "bus_stops.csv"), dtype={"stop_id": str, "ars_no": str})
    stop_name = stops.set_index("stop_id").name.astype(str)
    virtual = set(stops[stops.is_virtual == 1].stop_id)
    hcols = [f"{seg_day}_med_h{h:02d}" for h in range(24)]
    seg_by_route = {rid: g for rid, g in seg.groupby("route_id")}
    skipped = []

    for r in routes.itertuples():
        first, last, hw = getattr(r, f"{code}_first_sec"), getattr(r, f"{code}_last_sec"), getattr(r, f"{code}_headway_min")
        if any(pd.isna(v) for v in (first, last, hw)) or hw <= 0 or r.route_id not in seg_by_route:
            skipped.append(r.route_no)
            continue
        if str(r.route_no).startswith("한강"):   # 한강버스(선박)는 뺀다
            continue
        seq = rs[rs.route_id == r.route_id].sort_values("seq")
        g = seg_by_route[r.route_id].set_index("seq")
        seqs, sids = seq.seq.to_numpy(), seq.stop_id.to_numpy()
        prof = np.array([g.loc[q, hcols].to_numpy(dtype=np.int64) if q in g.index else np.full(24, 60)
                         for q in seqs[1:]], dtype=np.int64).reshape(-1, 24)

        def simulate(dep):
            out = np.empty((len(dep), len(seqs)), dtype=np.int64)
            out[:, 0] = t = np.asarray(dep, dtype=np.int64)
            for j in range(1, len(seqs)):
                t = t + prof[j - 1][(t // 3600) % 24]
                out[:, j] = t
            return out

        F = L = L_raw = None
        off = official.get(r.route_id)
        if off:
            # 순서 번호와 정류장 ID가 모두 맞는 칸만, 뒤 정류장보다 늦은 값은 버린다
            F = clean_monotone(np.array([off[q][1] if q in off and off[q][0] == sid else np.nan
                                         for q, sid in zip(seqs, sids)]))
            L_raw = np.array([off[q][2] if q in off and off[q][0] == sid else np.nan
                              for q, sid in zip(seqs, sids)])
            L = clean_monotone(L_raw)
            # 기본정보의 기점 막차·첫차가 공식 정류장 시각과 10분 넘게 어긋나면 공식 쪽에서 거꾸로 구한다
            # 정류장마다 '이 시각에 지나려면 기점을 언제 떠났어야 하나'를 구해 중앙값을 쓴다 (튀는 값에 강함)
            for arr_, which in ((L, "last"), (F, "first")):
                ok = np.flatnonzero(~np.isnan(arr_))
                if len(ok) < 2:
                    continue
                base = last if which == "last" else first
                probe = simulate([base])[0]
                est_each = arr_[ok] - (probe[ok] - probe[0])
                est = float(np.median(est_each))
                arr_[ok[np.abs(est_each - est) > OUTLIER_SEC]] = np.nan
                if abs(est - base) > 600:
                    if which == "last":
                        last = est
                    else:
                        first = est
            if last < first:
                F = L = None
                first, last = getattr(r, f"{code}_first_sec"), getattr(r, f"{code}_last_sec")
        # 기점 출발 시각: 막차에서 배차 간격씩 거슬러 올라간다
        n = int((last - first) // (hw * 60)) + 1
        d0 = np.sort(last - np.arange(n) * hw * 60).astype(np.int64)
        times = simulate(d0)
        applied = False
        if L is not None and (~np.isnan(L)).sum() >= 2:
            applied = True
            n_official += 1
            c_last = fill_along(L - times[-1])
            c_first = fill_along(F - times[0]) if (~np.isnan(F)).sum() >= 1 else np.zeros(len(seqs))
            w_last = np.clip(1 - (last - d0) / OFFICIAL_BLEND_SEC, 0, 1)
            w_first = np.clip(1 - (d0 - first) / OFFICIAL_BLEND_SEC, 0, 1)
            tot = w_last + w_first
            scale = np.where(tot > 1, 1 / np.maximum(tot, 1e-9), 1)
            times = times + np.rint((w_last * scale)[:, None] * c_last
                                    + (w_first * scale)[:, None] * c_first).astype(np.int64)
            # 정류장 순서대로 시각이 줄지 않게, 앞차가 뒤차보다 늦지 않게
            times = np.maximum.accumulate(times, axis=1)
            times = np.minimum.accumulate(times[::-1], axis=0)[::-1]
        times_arr = times.copy()
        times_dep = times.copy()
        if L_raw is not None:
            # 단축 운행: 공식 막차보다 늦게 지나는 운행은 그 정류장에서 타고 내릴 수 없다.
            # 튀는 값 하나로 막지 않게, 이웃 정류장도 같이 이른 경우만 적용한다
            late = times[-1] > L_raw + SHORT_TURN_SLACK          # 막차가 공식보다 늦게 지나는 정류장
            late &= ~np.isnan(L_raw)
            near = np.zeros_like(late)
            near[1:] |= late[:-1]
            near[:-1] |= late[1:]
            cut = late & near
            if cut.any():
                n_short_turn[0] += 1
                bad = (times > L_raw + SHORT_TURN_SLACK) & cut[None, :]
                times_arr[bad] = INF32
                times_dep[bad] = INF32
        # 가상정류장은 빼고 시간만 남긴다 (다음 실제 정류장 시각에 이미 더해져 있음)
        keep = ~seq.stop_id.isin(virtual).to_numpy()
        stop_idx = np.array([net.add_stop("bus", sid, stop_name.get(sid, sid)) for sid in seq.stop_id[keep]],
                            dtype=np.int32)
        times_arr, times_dep = times_arr[:, keep], times_dep[:, keep]
        labels = [f"기점 {fmt(x)} 출발" for x in d0]
        net.routes.append(Route("bus", str(r.route_no), stop_idx, times_arr.astype(np.int32), times_dep.astype(np.int32),
                                labels, headway_min=float(hw), route_id=r.route_id,
                                board_slack=int(hw * 60 * BUS_BOARD_SLACK_RATIO),
                                exact_first=applied and F is not None and (~np.isnan(F)).sum() >= 1,
                                exact_last=applied, stop_seq=seq.seq.to_numpy()[keep].astype(np.int32)))
    net.bus_official_routes = n_official
    net.bus_short_turn_routes = n_short_turn[0]
    bus_pts = stops[(stops.has_coord == 1) & (stops.is_virtual == 0)]
    return bus_pts, skipped


def load_footpaths(net):
    t = pd.read_csv(os.path.join(PREP_OUT, "transfers.csv"), dtype={"from_id": str, "to_id": str})
    net.footpaths = [[] for _ in net.stop_id]
    for a_kind, a_id, b_kind, b_id, w in zip(t.from_kind, t.from_id, t.to_kind, t.to_id, t.walk_sec):
        a, b = net.index.get((a_kind, a_id)), net.index.get((b_kind, b_id))
        if a is not None and b is not None:
            net.footpaths[a].append((b, int(w)))


def build(day="WD"):
    net = Network(day=day)
    rail_pts = load_rail(net, day)
    bus_pts, skipped = load_bus(net, day)
    load_footpaths(net)
    net.routes_at = [[] for _ in net.stop_id]
    for ri, r in enumerate(net.routes):
        for pos, s in enumerate(r.stops):
            net.routes_at[s].append((ri, pos))
    # 좌표 점 (출발·도착 주변 역·정류장 찾기용)
    ps, xy = [], []
    for p in rail_pts.itertuples():
        i = net.index.get(("rail", p.place_id))
        if i is not None:
            ps.append(i)
            xy.append((p.lat, p.lng))
    for p in bus_pts.itertuples():
        i = net.index.get(("bus", p.stop_id))
        if i is not None:
            ps.append(i)
            xy.append((p.lat, p.lon))
    xy = np.array(xy)
    net.point_stop = np.array(ps, dtype=np.int32)
    net.point_xy = to_xy(xy[:, 0], xy[:, 1])
    net.tree = cKDTree(net.point_xy)
    net.skipped_bus = skipped
    return net


def load(day="WD", rebuild=False):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"network_{day}_v{CACHE_VERSION}.pkl")
    inputs = [os.path.join(PREP_OUT, f) for f in
              ("stop_times.csv", "stations.csv", "bus_routes.csv", "bus_segments.csv", "transfers.csv")]
    if official_file(day):
        inputs.append(official_file(day))
    fresh = os.path.exists(path) and all(os.path.getmtime(path) > os.path.getmtime(f) for f in inputs)
    if fresh and not rebuild:
        with open(path, "rb") as f:
            return pickle.load(f)
    net = build(day)
    with open(path, "wb") as f:
        pickle.dump(net, f, protocol=pickle.HIGHEST_PROTOCOL)
    return net


def fmt(sec):
    sec = int(sec)
    h, m = sec // 3600, sec % 3600 // 60
    return f"{h:02d}:{m:02d}"

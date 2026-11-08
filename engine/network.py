"""
prep/out/의 지하철·버스·환승 표를 RAPTOR가 쓰는 노선망으로 만든다.

- 지하철: 정차 순서(place_id 나열)가 같은 열차끼리 한 노선(route)으로 묶는다
- 버스: 시각표가 없으므로 기점 막차 시각에서 배차 간격만큼 거슬러 올라가며 가상 운행을 만든다.
  정류장별 시각은 출발 시각대의 구간 운행시간(중앙값)을 차례로 더해 구한다. 막차 시각은 정확히 맞는다
- 운행일 유형(WD/SAT/HOL)마다 따로 만들고 engine/cache/에 저장한다

시각은 모두 운행일 기준 초 (자정 이후 86400 초과).
"""
import math
import os
import pickle
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

ENGINE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ENGINE)
PREP_OUT = os.path.join(ROOT, "prep", "out")
CACHE = os.path.join(ENGINE, "cache")
CACHE_VERSION = 3

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


def load_bus(net, day):
    code, seg_day = BUS_DAY[day]
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
        # 기점 출발 시각: 막차에서 배차 간격씩 거슬러 올라간다
        n = int((last - first) // (hw * 60)) + 1
        d0 = np.sort(last - np.arange(n) * hw * 60).astype(np.int64)
        times = np.empty((n, len(seq)), dtype=np.int64)
        times[:, 0] = d0
        t = d0.copy()
        for j, sq in enumerate(seq.seq.to_numpy()[1:], start=1):
            if sq in g.index:
                prof = g.loc[sq, hcols].to_numpy(dtype=np.int64)
            else:
                prof = np.full(24, 60, dtype=np.int64)
            t = t + prof[(t // 3600) % 24]
            times[:, j] = t
        # 가상정류장은 빼고 시간만 남긴다 (다음 실제 정류장 시각에 이미 더해져 있음)
        keep = ~seq.stop_id.isin(virtual).to_numpy()
        stop_idx = np.array([net.add_stop("bus", sid, stop_name.get(sid, sid)) for sid in seq.stop_id[keep]],
                            dtype=np.int32)
        times = times[:, keep]
        labels = [f"기점 {fmt(x)} 출발" for x in d0]
        net.routes.append(Route("bus", str(r.route_no), stop_idx, times.astype(np.int32), times.astype(np.int32),
                                labels, headway_min=float(hw), route_id=r.route_id))
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

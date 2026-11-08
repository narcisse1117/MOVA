"""
걸어서 갈아타는 연결(환승 도보)을 좌표로 만든다.

입력 (prep/out/, parse_rail.py와 parse_bus.py를 먼저 실행):
  manual_coords.csv  (prep/) 역사정보 좌표가 틀린 역을 직접 고친 값
  stations.csv     역 좌표, place_id (같은 place_id = 같은 역 안 환승은 엔진 기본값으로 처리)
  stop_times.csv   실제로 열차가 서는 place_id만 고르는 데 쓴다
  bus_stops.csv    버스 정류장 좌표

출력 (prep/out/):
  transfers.csv        from_kind,from_id → to_kind,to_id, 직선거리, 걷는 시간(초). 양방향 모두 적는다
                       kind: rail(place_id) / bus(stop_id)
  transfers_report.txt 요약, 주변에 연결이 없는 역·정류장

실행:  python prep/build_transfers.py
"""
import math
import os

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

PREP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(PREP, "out")

WALK_MPS = 1.1          # 밤 걷는 속도 (느린 쪽으로 잡는다)
DETOUR = 1.3            # 직선거리 → 실제 걷는 거리
RAIL_BUS_MAX_M = 400    # 역 ↔ 정류장 직선거리 한도
BUS_BUS_MAX_M = 250     # 정류장 ↔ 정류장 (길 건너편 포함)
RAIL_RAIL_MAX_M = 400   # 다른 장소인 역끼리 (예: 이름이 다른 가까운 역)
RAIL_EXIT_SEC = 120     # 승강장 ↔ 지상 (역 좌표는 역 중심이라 출구까지 시간을 더한다)

R_EARTH = 6371000.0


def to_xy(lat, lon):
    """서울 근처에서 쓸 평면 좌표(m)."""
    lat0 = math.radians(37.55)
    x = np.radians(lon) * R_EARTH * math.cos(lat0)
    y = np.radians(lat) * R_EARTH
    return np.column_stack([x, y])


def walk_sec(dist_m, extra):
    return np.ceil(dist_m * DETOUR / WALK_MPS).astype(int) + extra


def main():
    st = pd.read_csv(os.path.join(OUT, "stations.csv"), dtype={"place_id": str, "code": str})
    # 역사정보 좌표가 틀린 역은 manual_coords.csv 값으로 바꾼다
    fix = pd.read_csv(os.path.join(PREP, "manual_coords.csv"), dtype={"code": str})
    fixed = []
    for f in fix.itertuples():
        m = (st.code == f.code) & (st.name == f.name)
        st.loc[m, ["lat", "lng"]] = [f.lat, f.lng]
        st.loc[m, "coord_suspect"] = False
        fixed.append(f"{f.name}({f.code}) {int(m.sum())}행, {f.status}")
    used = set(pd.read_csv(os.path.join(OUT, "stop_times.csv"), usecols=["place_id"], dtype=str).place_id)
    st = st[st.place_id.isin(used) & ~st.coord_suspect & st.lat.notna()]
    # 역은 노선마다 좌표가 따로 있다. 정류장까지 거리는 그중 가장 가까운 것
    rail = st[["place_id", "name", "lat", "lng"]].rename(columns={"lng": "lon"}).reset_index(drop=True)

    bus = pd.read_csv(os.path.join(OUT, "bus_stops.csv"), dtype={"stop_id": str, "ars_no": str})
    bus = bus[bus.has_coord == 1].reset_index(drop=True)

    rxy, bxy = to_xy(rail.lat, rail.lon), to_xy(bus.lat, bus.lon)
    rtree, btree = cKDTree(rxy), cKDTree(bxy)
    parts = []

    # 역 ↔ 정류장
    pairs = rtree.query_ball_tree(btree, RAIL_BUS_MAX_M)
    rows = [(i, j) for i, js in enumerate(pairs) for j in js]
    if rows:
        i, j = map(np.array, zip(*rows))
        d = np.linalg.norm(rxy[i] - bxy[j], axis=1)
        rb = pd.DataFrame({"from_kind": "rail", "from_id": rail.place_id.values[i],
                           "to_kind": "bus", "to_id": bus.stop_id.values[j], "dist_m": d})
        rb = rb.sort_values("dist_m").drop_duplicates(["from_id", "to_id"])
        parts.append(rb)

    # 정류장 ↔ 정류장
    bb_pairs = btree.query_pairs(BUS_BUS_MAX_M, output_type="ndarray")
    d = np.linalg.norm(bxy[bb_pairs[:, 0]] - bxy[bb_pairs[:, 1]], axis=1)
    bb = pd.DataFrame({"from_kind": "bus", "from_id": bus.stop_id.values[bb_pairs[:, 0]],
                       "to_kind": "bus", "to_id": bus.stop_id.values[bb_pairs[:, 1]], "dist_m": d})
    parts.append(bb)

    # 다른 장소인 역 ↔ 역
    rr_pairs = rtree.query_pairs(RAIL_RAIL_MAX_M, output_type="ndarray")
    d = np.linalg.norm(rxy[rr_pairs[:, 0]] - rxy[rr_pairs[:, 1]], axis=1)
    rr = pd.DataFrame({"from_kind": "rail", "from_id": rail.place_id.values[rr_pairs[:, 0]],
                       "to_kind": "rail", "to_id": rail.place_id.values[rr_pairs[:, 1]], "dist_m": d})
    rr = rr[rr.from_id != rr.to_id].sort_values("dist_m")
    rr["key"] = rr[["from_id", "to_id"]].apply(lambda r: tuple(sorted(r)), axis=1)
    rr = rr.drop_duplicates("key").drop(columns="key")
    parts.append(rr)

    t = pd.concat(parts, ignore_index=True)
    rev = t.rename(columns={"from_kind": "to_kind", "from_id": "to_id", "to_kind": "from_kind", "to_id": "from_id"})
    t = pd.concat([t, rev[t.columns]], ignore_index=True)
    n_rail_ends = (t.from_kind == "rail").astype(int) + (t.to_kind == "rail").astype(int)
    t["walk_sec"] = walk_sec(t.dist_m.to_numpy(), (n_rail_ends * RAIL_EXIT_SEC).to_numpy())
    t["dist_m"] = t.dist_m.round().astype(int)
    t = t.sort_values(["from_kind", "from_id", "walk_sec"]).reset_index(drop=True)
    t.to_csv(os.path.join(OUT, "transfers.csv"), index=False, encoding="utf-8-sig")

    # 보고서
    rep = []
    rep.append(f"설정: 걷기 {WALK_MPS}m/s, 우회 {DETOUR}배, 역 출입 {RAIL_EXIT_SEC}초, "
               f"한도 역↔정류장 {RAIL_BUS_MAX_M}m, 정류장↔정류장 {BUS_BUS_MAX_M}m, 역↔역 {RAIL_RAIL_MAX_M}m")
    rep.append(f"좌표 직접 고침: {'; '.join(fixed)}")
    rep.append(f"역(place) {rail.place_id.nunique()}개, 정류장 {len(bus)}개 (좌표 있는 것)")
    kinds = t.groupby(["from_kind", "to_kind"]).size()
    for (a, b), n in kinds.items():
        rep.append(f"  {a} → {b}: {n}개")
    rb_out = t[(t.from_kind == "rail") & (t.to_kind == "bus")]
    near = rb_out.groupby("from_id").size()
    places = rail.drop_duplicates("place_id").set_index("place_id")
    lonely = places[~places.index.isin(near.index)]
    rep.append(f"역마다 연결된 정류장 수: 중앙값 {near.median():.0f}, 최대 {near.max()}")
    addr = st.drop_duplicates("place_id").set_index("place_id").addr.astype(str)
    in_seoul = addr.reindex(lonely.index).str.contains("서울")
    rep.append(f"{RAIL_BUS_MAX_M}m 안에 정류장이 없는 역 {len(lonely)}개 (서울 버스 데이터라 대부분 경기·인천). "
               f"이 중 주소가 서울인 역: {', '.join(lonely[in_seoul.values].name.astype(str)) or '없음'}")
    bb_out = t[(t.from_kind == "bus") & (t.to_kind == "bus")].groupby("from_id").size()
    rep.append(f"정류장마다 걸어갈 수 있는 다른 정류장 수: 중앙값 {bb_out.median():.0f}, 없는 정류장 {len(bus) - len(bb_out)}개")
    rep.append("")
    rep.append("== 예시: 역에서 가장 가까운 정류장 3개")
    names = bus.set_index("stop_id").name
    for nm in ["강남", "홍대입구", "잠실", "사당", "신림", "수유"]:
        pid = places[places.name == nm].index
        if pid.empty:
            continue
        rows = rb_out[rb_out.from_id == pid[0]].head(3)
        desc = ", ".join(f"{names.get(r.to_id, r.to_id)}({r.dist_m}m, {r.walk_sec // 60}분{r.walk_sec % 60}초)"
                         for r in rows.itertuples())
        rep.append(f"{nm}: {desc}")
    rr_out = t[(t.from_kind == "rail") & (t.to_kind == "rail")]
    rep.append("")
    rep.append(f"== 이름이 다른 가까운 역 ({len(rr_out) // 2}쌍)")
    for r in rr_out[rr_out.from_id < rr_out.to_id].head(30).itertuples():
        flag = "  ← 좌표가 겹침, 확인 필요" if r.dist_m < 50 else ""
        rep.append(f"{places.name.get(r.from_id)} ↔ {places.name.get(r.to_id)}: {r.dist_m}m{flag}")
    with open(os.path.join(OUT, "transfers_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(rep) + "\n")
    print("\n".join(rep))


if __name__ == "__main__":
    main()

"""
서울 버스 데이터 → 엔진용 표로 변환한다.

입력 (데이터/ 폴더):
  seoul_route_master.csv        노선 ID ↔ 번호, 유형 (fetch_seoul_master.py로 받음)
  seoul_station_master.csv      정류장 ID, 이름, 좌표
  seoul_route_node.csv          노선별 정류장 순서, 앞 정류장과의 거리(m)
  tpss_route_section_speedh_*.zip   구간별 시간대(00~23시) 운행시간(초), CP949
  서울시버스노선기본정보(*.xlsx)    평일·토·공휴일 첫차·막차·배차간격 (가장 최신 파일만 씀)

출력 (prep/out/):
  bus_routes.csv       서울 노선 + 요일 유형별 첫차·막차(운행일 기준 초)·배차
  bus_stops.csv        서울 노선이 지나는 정류장 + 좌표
  bus_route_stops.csv  노선별 정류장 순서와 누적 거리
  bus_segments.csv     구간(seq-1 → seq)별 시간대 운행시간 중앙값·90% 값 (평일 wd, 주말·공휴일 we)
  bus_report.txt       요약, 채운 값, 확인이 필요한 항목

실행:  python prep/parse_bus.py
"""
import datetime as dt
import glob
import os
import re
import zipfile

import numpy as np
import pandas as pd

PREP = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(PREP), "데이터")
OUT = os.path.join(PREP, "out")

N_WEEKS = 2               # 구간 운행시간은 최신 몇 주 파일을 쓸지
FALLBACK_KMH = 20.0       # 구간 값이 전혀 없을 때 쓰는 속도
# 구간 파일 기간 안의 공휴일 (주말과 같이 we로 묶는다). 나중에 특일 정보 API로 바꾼다
HOLIDAYS = {"20261003", "20261005", "20261009", "20261225"}
HOURS = list(range(24))
DAYTYPES = {"WD": "평일", "SAT": "토요일", "HOL": "공휴일"}


def hhmm_to_sec(v):
    """'23:30' → 초. 비었거나 이상하면 None."""
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", str(v))
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60


def to_service_day(first, last):
    """막차가 첫차보다 이르면 자정을 넘긴 것 → 86400을 더한다 (N버스 03:40 → 27:40).
    첫차가 03시 이전이면 (N26 00:00) 전날 운행일의 24시 이후로 본다."""
    if first is not None and first < 3 * 3600:
        first += 86400
        if last is not None and last < 3 * 3600 + 86400:
            last += 86400
    if first is not None and last is not None and last <= first:
        last += 86400
    return first, last


def num(v):
    try:
        f = float(v)
        return None if np.isnan(f) else f
    except (TypeError, ValueError):
        return None


def load_basic_info():
    files = sorted(glob.glob(os.path.join(DATA, "서울시버스노선기본정보(*).xlsx")))
    if not files:
        raise SystemExit("서울시버스노선기본정보 파일이 없습니다")
    path = files[-1]
    basis = re.search(r"\((\d{8})\)", path).group(1)
    xl = pd.ExcelFile(path)
    frames = {}
    for code, word in DAYTYPES.items():
        sheet = next(s for s in xl.sheet_names if s.startswith(word))
        d = xl.parse(sheet, dtype=str)
        d["노선번호"] = d["노선번호"].str.strip()
        rows = []
        for no, g in d.groupby("노선번호", sort=False):
            r = g.iloc[0]
            first, last = to_service_day(hhmm_to_sec(r["첫차시간"]), hhmm_to_sec(r["막차시간"]))
            rows.append({
                "route_no": no,
                "basic_type": r["유형"] if isinstance(r["유형"], str) else "",
                "basic_dist_km": num(r["거리"]),
                f"{code}_first_sec": first,
                f"{code}_last_sec": last,
                f"{code}_headway_min": num(r["배차간격"]),
                f"{code}_headway_lo": num(r["최소배차"]),
                f"{code}_headway_hi": num(r["최대배차"]),
                f"{code}_companies": len(g),
                f"{code}_conflict": int(g.drop(columns=["업체명"]).drop_duplicates().shape[0] > 1),
            })
        frames[code] = pd.DataFrame(rows).set_index("route_no")
    base = frames["WD"]
    for code in ("SAT", "HOL"):
        base = base.join(frames[code].drop(columns=["basic_type", "basic_dist_km"]), how="outer")
    return base.reset_index(), os.path.basename(path), basis


def pick_route_ids(basic, master, node_routes):
    """노선 번호 → RTE_ID. 같은 번호가 여럿이면 정류장 순서가 있고 거리가 가까운 쪽."""
    picks, issues = [], []
    for _, b in basic.iterrows():
        cand = master[master.RTE_NM == b.route_no].copy()
        if cand.empty:
            issues.append(f"노선 {b.route_no}: route_master에 없음")
            continue
        cand["has_node"] = cand.RTE_ID.isin(node_routes)
        cand["dist_gap"] = (cand.DIST.astype(float) - (b.basic_dist_km or 0)).abs()
        cand = cand.sort_values(["has_node", "dist_gap"], ascending=[False, True])
        best = cand.iloc[0]
        if len(cand) > 1:
            issues.append(f"노선 {b.route_no}: RTE_ID 후보 {len(cand)}개 → {best.RTE_ID} 선택 "
                          f"(정류장 순서 {'있음' if best.has_node else '없음'}, 거리 차 {best.dist_gap:.1f}km)")
        if not best.has_node:
            issues.append(f"노선 {b.route_no}({best.RTE_ID}): 정류장 순서 없음 → 엔진에서 못 씀")
        picks.append({"route_no": b.route_no, "route_id": best.RTE_ID,
                      "route_type": best.RTE_TYPE, "master_dist_km": float(best.DIST)})
    return pd.DataFrame(picks), issues


def daytype_of(yyyymmdd):
    if yyyymmdd in HOLIDAYS:
        return "we"
    return "we" if dt.datetime.strptime(yyyymmdd, "%Y%m%d").weekday() >= 5 else "wd"


def load_sections(route_ids):
    files = sorted(glob.glob(os.path.join(DATA, "tpss_route_section_speedh_*.zip")))[-N_WEEKS:]
    if not files:
        raise SystemExit("tpss_route_section_speedh 파일이 없습니다")
    parts = []
    for path in files:
        with zipfile.ZipFile(path) as z:
            with z.open(z.namelist()[0]) as f:
                d = pd.read_csv(f, encoding="cp949", header=0, dtype=str)
        d.columns = (["date", "route_id", "from_stop", "to_stop", "all"]
                     + [f"h{h:02d}" for h in HOURS] + ["from_seq", "to_seq"])
        d = d[d.route_id.isin(route_ids)]
        parts.append(d)
    d = pd.concat(parts, ignore_index=True)
    for c in ["all"] + [f"h{h:02d}" for h in HOURS]:
        d[c] = pd.to_numeric(d[c], errors="coerce").replace(0, np.nan)
    d["from_seq"] = pd.to_numeric(d.from_seq).astype(int)
    d["to_seq"] = pd.to_numeric(d.to_seq).astype(int)
    d["daytype"] = d.date.map(daytype_of)
    dates = sorted(d.date.unique())
    return d, [os.path.basename(p) for p in files], dates


def build_segments(route_stops, sec):
    """구간마다 시간대별 중앙값·90% 값. 빈 시간대는 가까운 시간대 → 다른 요일 유형 → 거리/속도 순으로 채운다."""
    hcols = [f"h{h:02d}" for h in HOURS]
    seg = route_stops[route_stops.seq > route_stops.groupby("route_id").seq.transform("min")]
    seg = seg[["route_id", "seq", "stop_id", "dist_from_prev_m"]].copy()
    prev = route_stops.set_index(["route_id", "seq"]).stop_id
    seg["prev_stop"] = prev.reindex(pd.MultiIndex.from_arrays([seg.route_id, seg.seq - 1])).to_numpy()
    # 순서 번호는 노선이 바뀌면 밀리므로 (앞 정류장, 다음 정류장) ID 쌍으로 잇는다
    key = ["route_id", "from_stop", "to_stop"]
    idx = pd.MultiIndex.from_arrays([seg.route_id, seg.prev_stop, seg.stop_id], names=key)
    g = sec.groupby(key + ["daytype"])[hcols]
    med, p90 = g.median(), g.quantile(0.9)
    allmed = sec.groupby(key)["all"].median()

    stats = {"cells": 0, "measured": 0, "near_hour": 0, "other_daytype": 0, "route_all": 0, "distance": 0}
    out = {}
    for dtp in ("wd", "we"):
        for kind, tab in (("med", med), ("p90", p90)):
            try:
                t = tab.xs(dtp, level="daytype")
            except KeyError:
                t = pd.DataFrame(columns=hcols)
            t = t.reindex(idx)
            out[(dtp, kind)] = t.to_numpy(dtype=float)
    src_route_all = allmed.reindex(idx).to_numpy(dtype=float)
    dist_sec = seg.dist_from_prev_m.to_numpy(dtype=float) / (FALLBACK_KMH / 3.6)

    def fill_near(a):
        """행마다 비어 있는 시간대를 가장 가까운 시간대 값으로 (원형, 같은 거리면 앞 시간대 = 더 막히는 쪽)."""
        a = a.copy()
        filled = np.zeros_like(a, dtype=bool)
        for shift in range(1, 12):
            empty = np.isnan(a)
            if not empty.any():
                break
            for s in (-shift, shift):
                cand = np.roll(a, -s, axis=1) if s > 0 else np.roll(a, -s, axis=1)
                take = np.isnan(a) & ~np.isnan(cand)
                a[take] = cand[take]
                filled |= take
        return a, filled

    for kind in ("med", "p90"):
        wd, we = out[("wd", kind)], out[("we", kind)]
        if kind == "med":
            stats["cells"] = wd.size + we.size
            stats["measured"] = int((~np.isnan(wd)).sum() + (~np.isnan(we)).sum())
        wd_f, wd_n = fill_near(wd)
        we_f, we_n = fill_near(we)
        # 요일 유형 전체가 빈 구간은 다른 유형에서 가져온다
        wd_o = np.isnan(wd_f) & ~np.isnan(we_f)
        we_o = np.isnan(we_f) & ~np.isnan(wd_f)
        wd_f[wd_o], we_f[we_o] = we_f[wd_o], wd_f[we_o]
        for a in (wd_f, we_f):
            rows_empty = np.isnan(a).all(axis=1)
            fb = np.where(np.isnan(src_route_all), dist_sec, src_route_all)
            if kind == "med":
                stats["route_all"] += int((rows_empty & ~np.isnan(src_route_all)).sum() * 24)
                stats["distance"] += int((rows_empty & np.isnan(src_route_all)).sum() * 24)
            a[rows_empty] = fb[rows_empty][:, None]
        if kind == "med":
            stats["near_hour"] = int(wd_n.sum() + we_n.sum())
            stats["other_daytype"] = int(wd_o.sum() + we_o.sum())
        out[("wd", kind)], out[("we", kind)] = wd_f, we_f

    res = seg[["route_id", "seq", "stop_id", "dist_from_prev_m"]].reset_index(drop=True)
    res["measured_hours_wd"] = (~np.isnan(med.xs("wd", level="daytype").reindex(idx).to_numpy(dtype=float))).sum(axis=1)
    res["no_section_data"] = np.isnan(allmed.reindex(idx).to_numpy(dtype=float)).astype(int)
    cols = {}
    for dtp in ("wd", "we"):
        for kind in ("med", "p90"):
            a = np.maximum(np.rint(out[(dtp, kind)]), 1).astype(int)
            for h in HOURS:
                cols[f"{dtp}_{kind}_h{h:02d}"] = a[:, h]
    # p90이 중앙값보다 작으면 안 된다
    for dtp in ("wd", "we"):
        for h in HOURS:
            m, p = f"{dtp}_med_h{h:02d}", f"{dtp}_p90_h{h:02d}"
            cols[p] = np.maximum(cols[p], cols[m])
    res = pd.concat([res, pd.DataFrame(cols)], axis=1)
    return res, stats


def simulate(seg_rows, depart_sec, dtp="wd", kind="med"):
    """기점 출발 시각부터 정류장마다 도착 시각을 더해 간다 (엔진에서 하는 계산의 확인용)."""
    t = depart_sec
    times = []
    for _, r in seg_rows.iterrows():
        h = int((t // 3600) % 24)
        t += r[f"{dtp}_{kind}_h{h:02d}"]
        times.append(t)
    return times


def fmt(sec):
    if sec is None or (isinstance(sec, float) and np.isnan(sec)):
        return "-"
    sec = int(sec)
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


def main():
    os.makedirs(OUT, exist_ok=True)
    report, issues = [], []

    master = pd.read_csv(os.path.join(DATA, "seoul_route_master.csv"), dtype=str, encoding="utf-8-sig")
    stations = pd.read_csv(os.path.join(DATA, "seoul_station_master.csv"), dtype=str, encoding="utf-8-sig")
    node = pd.read_csv(os.path.join(DATA, "seoul_route_node.csv"), dtype=str, encoding="utf-8-sig")
    node["seq"] = pd.to_numeric(node.CRTR_SEQ).astype(int)
    node["LNKG_LEN"] = pd.to_numeric(node.LNKG_LEN, errors="coerce")

    basic, basic_file, basis = load_basic_info()
    picks, pick_issues = pick_route_ids(basic, master, set(node.RTE_ID))
    issues += pick_issues
    routes = picks.merge(basic, on="route_no", how="left")
    routes["is_night"] = routes.route_no.str.startswith("N").astype(int)
    routes = routes[routes.route_id.isin(set(node.RTE_ID))]

    # 노선별 정류장 순서
    rs = node[node.RTE_ID.isin(routes.route_id)].rename(
        columns={"RTE_ID": "route_id", "CRTR_ID": "stop_id", "LNKG_LEN": "dist_from_prev_m"})
    rs = rs.sort_values(["route_id", "seq"])[["route_id", "seq", "stop_id", "dist_from_prev_m"]]
    first_seq = rs.groupby("route_id").seq.transform("min")
    rs.loc[rs.seq == first_seq, "dist_from_prev_m"] = 0
    rs["dist_from_prev_m"] = rs.dist_from_prev_m.fillna(0)
    rs["cum_dist_m"] = rs.groupby("route_id").dist_from_prev_m.cumsum()
    gaps = rs.groupby("route_id").seq.agg(lambda s: (s.diff().dropna() != 1).sum())
    for rid, n in gaps[gaps > 0].items():
        issues.append(f"노선 {rid}: 정류장 순서가 {n}군데 끊김")

    # 정류장
    st = stations.rename(columns={"CRTR_ID": "stop_id", "CRTR_NM": "name", "CRTR_TYPE": "kind",
                                  "CRTR_NO": "ars_no", "LAT": "lat", "LOT": "lon"})
    st = st[st.stop_id.isin(rs.stop_id)][["stop_id", "name", "ars_no", "kind", "lat", "lon"]]
    missing_stops = sorted(set(rs.stop_id) - set(st.stop_id))
    st = pd.concat([st, pd.DataFrame({"stop_id": missing_stops})], ignore_index=True)
    st["lat"] = pd.to_numeric(st.lat, errors="coerce")
    st["lon"] = pd.to_numeric(st.lon, errors="coerce")
    st["has_coord"] = st.lat.notna().astype(int)
    st["in_seoul_id"] = st.stop_id.str[0].eq("1").astype(int)

    # 구간 운행시간
    sec, sec_files, dates = load_sections(set(routes.route_id))
    seg, fill = build_segments(rs, sec)
    no_data = seg[seg.no_section_data == 1]
    for rid, n in no_data.route_id.value_counts().items():
        if n >= 5:
            issues.append(f"노선 {rid}: 구간 운행시간이 없는 구간 {n}개 (거리로 추정)")

    # 노선 요약 칸
    agg = rs.groupby("route_id").agg(n_stops=("seq", "size"), length_m=("cum_dist_m", "max"))
    routes = routes.merge(agg, left_on="route_id", right_index=True, how="left")
    routes["basis_date"] = basis
    lead = ["route_id", "route_no", "route_type", "basic_type", "is_night", "n_stops", "length_m"]
    routes = routes[lead + [c for c in routes.columns if c not in lead]]

    routes.to_csv(os.path.join(OUT, "bus_routes.csv"), index=False, encoding="utf-8-sig")
    st.to_csv(os.path.join(OUT, "bus_stops.csv"), index=False, encoding="utf-8-sig")
    rs.to_csv(os.path.join(OUT, "bus_route_stops.csv"), index=False, encoding="utf-8-sig")
    seg.to_csv(os.path.join(OUT, "bus_segments.csv"), index=False, encoding="utf-8-sig")

    # 보고서
    report.append("== 입력")
    report.append(f"기본정보: {basic_file} (노선 {len(basic)}개)")
    report.append(f"구간 운행시간: {', '.join(sec_files)} ({dates[0]}~{dates[-1]}, {len(dates)}일)")
    report.append("")
    report.append("== 결과")
    report.append(f"노선 {len(routes)}개 (N버스 {routes.is_night.sum()}개), 정류장 {len(st)}개 "
                  f"(좌표 없음 {int((st.has_coord == 0).sum())}개, 이 중 서울 ID {int(((st.has_coord == 0) & (st.in_seoul_id == 1)).sum())}개)")
    report.append(f"구간 {len(seg)}개, 구간 운행시간 파일에 없는 구간 {len(no_data)}개")
    c = fill["cells"]
    report.append(f"시간대 칸(중앙값, wd+we) {c}개: 실측 {fill['measured'] / c:.0%}, "
                  f"가까운 시간대로 채움 {fill['near_hour'] / c:.0%}, 다른 요일 유형 {fill['other_daytype'] / c:.0%}, "
                  f"구간 평균 {fill['route_all'] / c:.0%}, 거리/{FALLBACK_KMH:.0f}km/h {fill['distance'] / c:.0%}")
    for h in (22, 23, 0, 1):
        col = f"h{h:02d}"
        has = sec[sec.daytype == "wd"].groupby(["route_id", "from_stop", "to_stop"])[col].apply(lambda s: s.notna().any())
        report.append(f"  평일 {h:02d}시 실측이 있는 구간 비율: {has.mean():.0%}")
    report.append("")
    report.append("== 막차 (평일, 기점 출발 → 마지막 정류장 도착 추정, 중앙값 / 90%)")
    sample = ["N13", "N15", "N26", "143", "146", "472", "6716", "740", "1115", "02"]
    for no in sample:
        r = routes[routes.route_no == no]
        if r.empty:
            continue
        r = r.iloc[0]
        rows = seg[seg.route_id == r.route_id]
        if rows.empty or pd.isna(r.WD_last_sec):
            continue
        a = simulate(rows, r.WD_last_sec, "wd", "med")[-1]
        b = simulate(rows, r.WD_last_sec, "wd", "p90")[-1]
        report.append(f"{no:>5}: 첫차 {fmt(r.WD_first_sec)} 막차 {fmt(r.WD_last_sec)} 배차 {r.WD_headway_min:.0f}분 "
                      f"→ 끝 정류장 {fmt(a)} / {fmt(b)} (정류장 {len(rows) + 1}개)")
    report.append("")
    conflicts = routes[(routes[["WD_conflict", "SAT_conflict", "HOL_conflict"]].fillna(0) > 0).any(axis=1)]
    report.append(f"== 확인 필요 ({len(issues) + len(conflicts)}개)")
    for _, r in conflicts.iterrows():
        report.append(f"노선 {r.route_no}: 공동배차 회사끼리 기본정보 값이 다름 (첫 행 사용)")
    report += issues
    with open(os.path.join(OUT, "bus_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report[:30]))


if __name__ == "__main__":
    main()

"""
국가철도공단 도시광역철도 운행정보 + 역사정보 → 엔진용 표로 변환한다.

입력 (같은 폴더의 상위 디렉터리):
  전체_도시철도운행정보_*.xlsx
  전체_도시철도역사정보_*.xlsx

출력 (prep/out/):
  stations.csv      역사정보 + 같은 장소(이름·좌표)로 묶은 place_id
  stop_times.csv    열차·정거장별 도착/출발 시각(초, 24시 넘김 허용)
  name_aliases.csv  운행정보의 역 이름 → 역사정보 장소 대응표 (needs_review 표시)
  report.txt        노선별 요약, 확인이 필요한 항목

실행:  python prep/parse_rail.py
"""
import glob
import math
import os
import re
from collections import defaultdict

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# 서울을 지나는 노선만 다룬다 (확장할 때 여기에 추가)
LINES = [
    "S1101", "S1102", "S1103", "S1104", "S1105", "S1106", "S1107", "S1108", "S1109",
    "I11D1", "L11UI", "L11SL", "I28A1",
    "I1101", "I4101", "I4103", "I4106", "I4108", "I41K2", "I28K1", "I41WS",
]
# 서울교통공사 등 '열차 한 줄' 형식 노선. 코레일 노선과 같은 열차가 겹치면 이쪽을 남긴다
PRIMARY_PREFIXES = ("S11", "I11D1", "L11", "I28A1")

PLACE_RADIUS_M = 700      # 같은 이름이면서 이 거리 안이면 같은 장소(환승역)로 본다
NEIGHBOR_OK_M = 6000      # 후보가 이웃 역에서 이 거리 안이면 믿을 만하다


# ---------- 공통 ----------
def haversine(a, b):
    lat1, lng1 = a
    lat2, lng2 = b
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def norm(name):
    """역 이름 비교용 키: 괄호 내용과 끝의 '역' 제거"""
    s = re.sub(r"\(.*?\)", "", str(name)).strip()
    s = re.sub(r"역$", "", s)
    return s.replace(" ", "")


def norm_concat(name):
    """괄호 내용을 이어 붙인 키: 쌍용(나사렛대) → 쌍용나사렛대"""
    s = str(name).replace("(", "").replace(")", "").strip()
    return re.sub(r"역$", "", s).replace(" ", "")


def to_sec(v):
    """'24:52', '05:30:00', datetime.time → 초. 빈 값/표시용 값은 None"""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if hasattr(v, "hour"):
        return v.hour * 3600 + v.minute * 60 + v.second
    m = re.match(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$", str(v))
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3) or 0)


SERVICE_DAY_START = 3 * 3600  # 03시 이전 시각은 전날 운행일의 연장(24시 이후)으로 본다


def to_service_sec(sec):
    """자정 이후를 00:10처럼 적는 노선(신분당선 등)을 24:10으로 바꾼다. 지하철은 03~05시에 운행하지 않는다."""
    if sec is None:
        return None
    return sec + 86400 if sec < SERVICE_DAY_START else sec


def service_days(label):
    """요일 구분 → {'WD','SAT','HOL'}. 일요일은 HOL로 본다. 명절은 빈 집합(제외)"""
    days = set()
    for p in re.split(r"[+,]", str(label)):
        p = p.strip()
        if p == "평일":
            days.add("WD")
        elif p in ("토요일", "토"):
            days.add("SAT")
        elif p in ("공휴일", "일요일"):
            days.add("HOL")
        elif p in ("휴일", "주말"):
            days |= {"SAT", "HOL"}
    return days


# ---------- 운행정보 파싱 ----------
STN_ITEM = re.compile(r"^\s*([A-Z]?\d+[A-Z]?\d*)-(.+?)\s*$")
TIME_PAIR = re.compile(r"([A-Z]?\d+[A-Z]?\d*)[-+](\d{1,2}:\d{2}(?::\d{2})?|:|)(?=[+,]|$)")


def parse_packed(stn, arr, dep):
    """'001-성수+002-뚝섬' 형식 (서울교통공사 등). 코드로 도착·출발을 맞춘다."""
    items = [x for x in re.split(r"[+,]", str(stn)) if x.strip()]
    codes, names = [], []
    for i, it in enumerate(items):
        m = STN_ITEM.match(it)
        if m:
            codes.append(m.group(1))
            names.append(m.group(2))
        else:  # 코드 없는 첫 항목 (7호선 연장 구간 형식)
            codes.append(f"_pos{i}")
            names.append(it.strip())
    arr_map = {c: t for c, t in TIME_PAIR.findall(str(arr))} if isinstance(arr, str) else {}
    dep_map = {c: t for c, t in TIME_PAIR.findall(str(dep))} if isinstance(dep, str) else {}
    raw = []
    for c, n in zip(codes, names):
        a = to_sec(arr_map.get(c))
        d = to_sec(dep_map.get(c))
        # 이 형식은 자정 이후를 24:xx로 적으므로 '00:00'은 빈 값(첫 역 도착, 끝 역 출발, 통과역) 표시다
        if a == 0:
            a = None
        if d == 0:
            d = None
        if a is None and d is None:
            continue
        raw.append([n, to_service_sec(a), to_service_sec(d)])
    if len(raw) < 2:
        return [], "ok"

    def mono(vals):
        v = [x for x in vals if x is not None]
        return all(v[i + 1] >= v[i] - 60 for i in range(len(v) - 1))

    arr_ok, dep_ok = mono([x[1] for x in raw]), mono([x[2] for x in raw])
    quality = "ok"
    if dep_ok and not arr_ok:
        # 도착 시각만 어긋남 → 출발 시각을 쓴다. 역 이름과 시각이 어긋났을 수 있어 표시한다 (1호선 경인 구간 등)
        quality = "suspect_arr"
        for x in raw:
            x[1] = x[2]
    elif arr_ok and not dep_ok:
        # 출발 시각만 거꾸로 적힘 (신림선 일부) → 도착 시각을 쓰고, 첫 역 출발은 다음 역 도착 2분 전
        quality = "dep_from_arr"
        for x in raw:
            x[2] = x[1]
        if raw[0][1] is None and raw[1][1] is not None:
            raw[0][1] = raw[0][2] = raw[1][1] - 120
    elif not arr_ok and not dep_ok:
        quality = "suspect_order"
        raw.sort(key=lambda x: x[2] if x[2] is not None else x[1])
    QUALITY[quality] += 1
    rows = []
    for n, a, d in raw:
        if a is None:
            a = d
        if d is None:
            d = a
        if a is None:
            continue
        rows.append((n, a, d))
    return rows, quality


QUALITY = defaultdict(int)


BAD_ORDER = defaultdict(int)


def fix_rollover(rows, lineno=""):
    """시각이 뒤로 가면(자정 넘김) 24시간을 더해 단조 증가로 만든다."""
    out, offset, prev = [], 0, None
    for n, a, d in rows:
        a2, d2 = a + offset, d + offset
        # 밤(20시 이후) 다음에 새벽(6시 이전) 시각이 오면 자정을 넘긴 것으로 본다. 한 번만 넘길 수 있다
        if (prev is not None and offset == 0 and prev % 86400 >= 20 * 3600
                and a < 6 * 3600 and a2 < prev):
            offset += 24 * 3600
            a2, d2 = a + offset, d + offset
        elif prev is not None and a2 < prev - 600:
            BAD_ORDER[lineno] += 1
            continue  # 순서가 맞지 않는 시각(데이터 오류)은 버리고 보고서에 센다
        if d2 < a2:
            d2 += 24 * 3600
        out.append((n, a2, d2))
        prev = d2
    return out


def load_trips(path):
    df = pd.read_excel(path, usecols=range(13))
    df.columns = ["train", "lineno", "line", "frm", "to", "type", "day",
                  "stn", "arr", "dep", "speed", "tel", "asof"]
    df = df[df.lineno.isin(LINES)]
    trips = []  # dict(trip_id, lineno, line, train, type, days, frm, to, asof, stops=[(raw,a,d)])
    packed_mask = df.stn.astype(str).str.contains(r"[+,]") & df.stn.astype(str).str.contains("-")

    # 1) 열차 한 줄 형식
    for r in df[packed_mask].itertuples(index=False):
        days = service_days(r.day)
        if not days:
            continue
        parsed, quality = parse_packed(r.stn, r.arr, r.dep)
        stops = fix_rollover(parsed, r.lineno)
        if len(stops) < 2:
            continue
        trips.append(dict(lineno=r.lineno, line=r.line, train=str(r.train), type=r.type,
                          day_label=r.day, days=days, frm=r.frm, to=r.to, asof=r.asof,
                          quality=quality, stops=stops))

    # 2) 정거장 한 줄 형식 (코레일 등): 파일 순서를 유지한 채 열차·요일별로 묶는다
    rest = df[~packed_mask]
    for (lineno, train, day, frm, to), g in rest.groupby(
            ["lineno", "train", "day", "frm", "to"], sort=False):
        days = service_days(day)
        if not days:
            continue
        raw = []
        for r in g.itertuples(index=False):
            a, d = to_service_sec(to_sec(r.arr)), to_service_sec(to_sec(r.dep))
            if a is None:
                a = d
            if d is None:
                d = a
            if a is None:
                continue
            raw.append((str(r.stn).strip(), a, d))
        stops = fix_rollover(raw, lineno)
        if len(stops) < 2:
            continue
        g0 = g.iloc[0]
        trips.append(dict(lineno=lineno, line=g0["line"], train=str(train), type=g0["type"],
                          day_label=day, days=days, frm=frm, to=to, asof=g0["asof"],
                          quality="ok", stops=stops))
    return trips


# ---------- 역사정보 ----------
def load_stations(path):
    st = pd.read_excel(path)
    st.columns = ["code", "name", "lineno", "line", "en", "hanja", "xfer", "xlineno",
                  "xline", "lat", "lng", "op", "addr", "tel", "asof"]
    st["key"] = st.name.map(norm)
    st["key2"] = st.name.map(norm_concat)
    # 같은 이름 + 가까운 좌표 → 하나의 장소(place)
    place_ids, places = [], []  # places: (key, lat, lng, place_id)
    for r in st.itertuples(index=False):
        pid = None
        for k, la, ln, p in places:
            if k == r.key and haversine((la, ln), (r.lat, r.lng)) <= PLACE_RADIUS_M:
                pid = p
                break
        if pid is None:
            pid = f"P{len(places):04d}"
            places.append((r.key, r.lat, r.lng, pid))
        place_ids.append(pid)
    st["place_id"] = place_ids
    # 주소는 서울인데 좌표가 서울 밖이면 좌표 오류로 본다 (예: 양원역)
    in_seoul_box = st.lat.between(37.41, 37.72) & st.lng.between(126.76, 127.19)
    st["coord_suspect"] = st.addr.astype(str).str.startswith("서울") & ~in_seoul_box
    return st


# ---------- 이름 대응 ----------
def build_aliases(trips, st):
    place_xy = st.groupby("place_id")[["lat", "lng"]].mean()
    place_name = st.groupby("place_id").name.first()
    by_key = defaultdict(set)
    for r in st.itertuples(index=False):
        by_key[r.key].add(r.place_id)
        by_key[r.key2].add(r.place_id)
    all_keys = list(by_key.keys())

    # (노선, 원래 이름)별 이웃 이름
    neighbors = defaultdict(set)
    for t in trips:
        names = [s[0] for s in t["stops"]]
        for i, n in enumerate(names):
            for j in (i - 1, i + 1):
                if 0 <= j < len(names):
                    neighbors[(t["lineno"], n)].add(names[j])

    manual = {}
    manual_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manual_aliases.csv")
    if os.path.exists(manual_path):
        m = pd.read_csv(manual_path, dtype=str).fillna("")
        manual = {r.raw_name.strip(): norm(r.target_name) for r in m.itertuples(index=False)}

    def candidates(raw):
        k = norm(raw)
        if raw.strip() in manual and manual[raw.strip()] in by_key:
            return set(by_key[manual[raw.strip()]]), "manual"
        if k in by_key:
            return set(by_key[k]), "exact"
        variants = []
        v = re.sub(r"^\d+", "", k)          # 앞 숫자(노선 표시) 제거: 4동대 → 동대
        variants.append(v)
        if v.startswith("지하"):
            variants.append(v[2:])
        if v.startswith("지"):
            variants.append(v[1:])           # 1지청 → 청 (지하 청량리 등)
        if v.endswith("구") or v.endswith("가"):
            variants.append(v[:-1])
        for vv in variants:
            if not vv:
                continue
            c = set()
            for key in all_keys:
                if key.startswith(vv):
                    c |= by_key[key]
            if c:
                return c, "prefix" if vv == v else "prefix_variant"
        return set(), "none"

    keys = sorted({(t["lineno"], s[0]) for t in trips for s in t["stops"]})
    resolved = {}  # (lineno, raw) -> place_id
    info = {}
    for key in keys:
        info[key] = candidates(key[1])
    # 같은 노선에서 정확히 맞은 이름이 이미 차지한 장소는 줄임말 후보에서 뺀다
    # (예: '종로5'가 종로5가를 차지하면 '1종로'는 종로3가)
    taken = defaultdict(set)
    for key, (c, method) in info.items():
        if len(c) == 1:
            taken[key[0]] |= c
    for key in keys:
        c, method = info[key]
        if method not in ("exact", "manual"):
            c2 = c - taken[key[0]]
            if c2:
                c = c2
            info[key] = (c, method)
        if len(c) == 1:
            resolved[key] = next(iter(c))
        elif len(c) > 1:
            xy = [tuple(place_xy.loc[p]) for p in c]
            spread = max(haversine(a, b) for a in xy for b in xy)
            if spread <= PLACE_RADIUS_M:
                resolved[key] = sorted(c)[0]

    # 이웃 역 좌표로 후보 고르기 (두 번 반복)
    dist_to_nb = {}
    for _ in range(3):
        for key in keys:
            c, method = info[key]
            nb_xy = [tuple(place_xy.loc[resolved[(key[0], n)]])
                     for n in neighbors[key] if (key[0], n) in resolved]
            if not c or not nb_xy:
                continue
            best, bestd = None, None
            for p in c:
                d = min(haversine(tuple(place_xy.loc[p]), xy) for xy in nb_xy)
                if bestd is None or d < bestd:
                    best, bestd = p, d
            if key not in resolved or method not in ("exact",) or len(c) > 1:
                resolved[key] = best
            dist_to_nb[key] = bestd

    rows = []
    for key in keys:
        c, method = info[key]
        pid = resolved.get(key)
        d = dist_to_nb.get(key)
        if pid is None:
            conf = "none"
        elif method == "manual":
            conf = "manual" if d is None or d <= NEIGHBOR_OK_M else "low"
        elif method == "exact" and len(c) == 1:
            conf = "high"
        elif d is not None and d <= NEIGHBOR_OK_M and (len(c) == 1 or method == "exact"):
            conf = "high"
        elif d is not None and d <= NEIGHBOR_OK_M:
            conf = "medium"
        else:
            conf = "low"
        rows.append(dict(
            lineno=key[0], raw_name=key[1], method=method,
            place_id=pid or "", resolved_name=place_name.get(pid, "") if pid else "",
            n_candidates=len(c),
            candidates=" / ".join(sorted(place_name[p] for p in c))[:200],
            nearest_neighbor_m=round(d) if d is not None else "",
            confidence=conf,
            needs_review=conf in ("medium", "low", "none"),
        ))
    return pd.DataFrame(rows), resolved


def mark_geo_quality(trips, resolved, st):
    """좌표로 본 이동 속도가 비현실적이면(역 이름과 시각이 어긋난 경우) suspect_geo로 표시한다.
    시각이 분 단위라 60초 여유를 둔다. 좌표가 의심스러운 역은 판단에서 뺀다."""
    ok_st = st[~st.coord_suspect]
    xy = ok_st.groupby("place_id")[["lat", "lng"]].mean()
    for t in trips:
        pts = [(resolved.get((t["lineno"], n)), a, d) for n, a, d in t["stops"]]
        pts = [p for p in pts if p[0] in xy.index]
        for (p1, _, d1), (p2, a2, _) in zip(pts, pts[1:]):
            dist = haversine(tuple(xy.loc[p1]), tuple(xy.loc[p2]))
            dt = max(a2 - d1, 0) + 60
            if dist > 1500 and dist / dt * 3.6 > 130:
                if t["quality"] == "ok":
                    t["quality"] = "suspect_geo"
                break


# ---------- 중복 열차 제거 ----------
def drop_duplicates(trips, resolved):
    """같은 열차가 서울교통공사 형식과 코레일 형식에 모두 있으면(장소·시각 3곳 이상 일치) 하나만 남긴다.
    기본은 서울교통공사 형식을 남기고, 그쪽이 suspect로 표시됐으면 코레일 형식을 남긴다."""
    def is_primary(t):
        return t["lineno"].startswith(PRIMARY_PREFIXES)

    def build_index(ids):
        index = defaultdict(set)
        for i in ids:
            t = trips[i]
            for n, a, d in t["stops"]:
                p = resolved.get((t["lineno"], n))
                if p:
                    for day in t["days"]:
                        index[(p, d % 86400, day)].add(i)
        return index

    def best_hit(t, index):
        hits = defaultdict(int)
        for n, a, d in t["stops"]:
            p = resolved.get((t["lineno"], n))
            if not p:
                continue
            for day in t["days"]:
                for j in index.get((p, d % 86400, day), ()):
                    hits[j] += 1
        return max(hits.values()) if hits else 0

    good_primary = [i for i, t in enumerate(trips) if is_primary(t) and not t["quality"].startswith("suspect")]
    bad_primary = [i for i, t in enumerate(trips) if is_primary(t) and t["quality"].startswith("suspect")]
    korail = [i for i, t in enumerate(trips) if not is_primary(t)]

    idx_good = build_index(good_primary)
    korail_keep = [i for i in korail if best_hit(trips[i], idx_good) < 3]
    dropped = [trips[i] for i in korail if i not in set(korail_keep)]

    idx_korail = build_index(korail_keep)
    replaced = [i for i in bad_primary if best_hit(trips[i], idx_korail) >= 3]
    dropped += [trips[i] for i in replaced]
    keep_ids = set(good_primary) | (set(bad_primary) - set(replaced)) | set(korail_keep)
    return [t for i, t in enumerate(trips) if i in keep_ids], dropped, len(replaced)


def fmt(sec):
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


def main():
    def find(pattern):
        # 상위 폴더 또는 데이터/ 폴더에서 가장 최신 파일
        hits = glob.glob(os.path.join(ROOT, pattern)) + glob.glob(os.path.join(ROOT, "데이터", pattern))
        if not hits:
            raise SystemExit(f"{pattern} 파일이 없습니다. 상위 폴더나 데이터/ 폴더에 넣어 주세요.")
        return sorted(hits, key=os.path.basename)[-1]
    run_path = find("전체_도시철도운행정보_*.xlsx")
    st_path = find("전체_도시철도역사정보_*.xlsx")
    os.makedirs(OUT, exist_ok=True)

    print("역사정보 읽는 중...")
    st = load_stations(st_path)
    print("운행정보 읽는 중... (1~2분)")
    trips = load_trips(run_path)
    print(f"열차 {len(trips)}개")

    aliases, resolved = build_aliases(trips, st)
    # 수도권을 전혀 지나지 않는 열차(경부선 코드에 섞인 대구권 광역철도 등)는 뺀다
    lat_of = st.groupby("place_id").lat.mean()
    def in_capital(t):
        lats = [lat_of[resolved[(t["lineno"], n)]] for n, _, _ in t["stops"]
                if (t["lineno"], n) in resolved]
        if not lats:
            return False
        lats.sort()
        return lats[len(lats) // 2] >= 36.7   # 정차역 절반 이상이 수도권(천안 이북)
    n0 = len(trips)
    trips = [t for t in trips if in_capital(t)]
    print(f"수도권 밖 열차 {n0 - len(trips)}개 제외")
    aliases, resolved = build_aliases(trips, st)
    mark_geo_quality(trips, resolved, st)
    trips, dropped, n_replaced = drop_duplicates(trips, resolved)

    st.drop(columns=["key", "key2"]).to_csv(os.path.join(OUT, "stations.csv"),
                                           index=False, encoding="utf-8-sig")
    aliases.to_csv(os.path.join(OUT, "name_aliases.csv"), index=False, encoding="utf-8-sig")

    rows = []
    for t in trips:
        trip_id = f"{t['lineno']}|{t['train']}|{t['day_label']}|{t['frm']}>{t['to']}"
        for seq, (n, a, d) in enumerate(t["stops"]):
            rows.append((trip_id, t["lineno"], t["line"], t["train"], t["type"],
                         ",".join(sorted(t["days"])), t["frm"], t["to"], seq, n,
                         resolved.get((t["lineno"], n), ""), a, d,
                         t["asof"].date() if hasattr(t["asof"], "date") else t["asof"],
                         t["quality"]))
    stop_times = pd.DataFrame(rows, columns=[
        "trip_id", "lineno", "line", "train", "type", "service_days", "origin", "terminus",
        "seq", "raw_name", "place_id", "arr_sec", "dep_sec", "data_asof", "quality"])
    stop_times.to_csv(os.path.join(OUT, "stop_times.csv"), index=False, encoding="utf-8-sig")

    # ---------- 보고서 ----------
    lines = []
    lines.append(f"입력: {os.path.basename(run_path)}, {os.path.basename(st_path)}")
    lines.append(f"열차 {len(trips)}개, 정차 {len(stop_times)}행")
    lines.append(f"  중복 제거 {len(dropped)}개 (그중 suspect인 서울교통공사 형식을 코레일 형식으로 바꾼 것 {n_replaced}개), 수도권 밖 열차 {n0 - (len(trips) + len(dropped))}개 제외")
    cs = st[st.coord_suspect]
    lines.append(f"좌표가 주소와 맞지 않는 역 {len(cs)}개 (stations.csv의 coord_suspect, 좌표를 직접 고쳐야 함): " + ", ".join(cs.name + "(" + cs.line + ")"))
    lines.append("시각 순서가 맞지 않아 버린 정차: " + ", ".join(f"{k} {v}건" for k, v in sorted(BAD_ORDER.items())))
    q = stop_times.drop_duplicates("trip_id").groupby(["lineno", "quality"]).size()
    q = q[q.index.get_level_values(1) != "ok"]
    lines.append("품질 표시가 붙은 열차 (suspect_*: 역 이름과 시각이 어긋났을 수 있음, dep_from_arr: 출발 시각을 도착 시각으로 대신함)")
    for (ln, ql), n in q.items():
        lines.append(f"  {ln} {ql}: {n}개")
    lines.append(f"정차 시각 범위: {fmt(int(stop_times.dep_sec.min()))} ~ {fmt(int(stop_times.dep_sec.max()))}")
    lines.append("")
    lines.append("노선별 요약 (평일 기준 막차 = 출발 시각이 가장 늦은 열차)")
    for ln, g in stop_times.groupby("lineno"):
        wd = g[g.service_days.str.contains("WD")]
        nt = g.trip_id.nunique()
        asof = g.data_asof.iloc[0]
        unresolved = (g.place_id == "").sum()
        last = wd.groupby("trip_id").dep_sec.min().sort_values().tail(1)
        last_txt = ""
        if len(last):
            tid = last.index[0]
            o = wd[wd.trip_id == tid].sort_values("seq")
            last_txt = f"{o.raw_name.iloc[0]} {fmt(o.dep_sec.iloc[0])} → {o.raw_name.iloc[-1]} {fmt(o.arr_sec.iloc[-1])}"
        lines.append(f"  {ln} {g.line.iloc[0]}: 열차 {nt}, 기준일 {asof}, 장소 미매칭 정차 {unresolved}, 평일 마지막 출발 {last_txt}")
    lines.append("")
    rv = aliases[aliases.needs_review]
    lines.append(f"이름 대응: 전체 {len(aliases)}, 확인 필요 {len(rv)} (medium {sum(rv.confidence=='medium')}, low {sum(rv.confidence=='low')}, none {sum(rv.confidence=='none')})")
    for r in rv.itertuples(index=False):
        lines.append(f"  [{r.confidence}] {r.lineno} '{r.raw_name}' → '{r.resolved_name}' (후보: {r.candidates})")
    with open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines[:40]))
    print(f"\n출력: {OUT}")


if __name__ == "__main__":
    main()

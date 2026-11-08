"""요금 계산: 택시 미터기, 대중교통 통합환승, 버스 종류별 기본요금."""
import numpy as np

import fares


def fare(dist_m, drive_sec, hour):
    return int(fares.taxi_fare(np.array([dist_m]), np.array([drive_sec]), np.array([hour * 3600]))[0])


def test_taxi_base_fare_by_time_band():
    # 1.6km 안이면 기본요금 (저속 구간 시간 요금이 조금 붙을 수 있어 100원 여유)
    assert 4800 <= fare(1500, 200, 14) <= 4900
    assert 5800 <= fare(1500, 200, 22) <= 5900       # 22~23시 20%
    assert 6700 <= fare(1500, 200, 0) <= 6800        # 23~02시 40%
    assert 5800 <= fare(1500, 200, 3) <= 5900        # 02~04시 20%


def test_taxi_night40_10km_close_to_official_formula():
    # 23~02시: 6,700원 + 131m당 140원. 10km면 약 15,700원 (시간 요금 근사로 조금 다를 수 있음)
    got = fare(10000, 1200, 0)
    formula = 6700 + (10000 - 1600) // 131 * 140
    assert abs(got - formula) <= 600
    assert got % 100 == 0                             # 100원 단위 반올림


def test_taxi_fare_increases_with_distance():
    assert fare(5000, 600, 23) < fare(10000, 1200, 23) < fare(20000, 2400, 23)


def test_bus_base_by_route_type():
    assert fares.bus_base("143", "간선") == 1500
    assert fares.bus_base("6716", "지선") == 1500
    assert fares.bus_base("01A", "순환") == 1400
    assert fares.bus_base("마포05", "마을") == 1200
    assert fares.bus_base("9401", "광역") == 3000
    assert fares.bus_base("N26", None) == 2500
    assert fares.bus_base("마포05", None) == 1200     # 유형이 없으면 이름으로 추정


def test_transit_fare_integrated_transfer():
    sub = {"type": "rail", "line": "2호선", "dist_m": 8000}
    bus = {"type": "bus", "line": "143", "route_type": "간선", "dist_m": 7000}
    night = {"type": "bus", "line": "N26", "route_type": None, "dist_m": 3000}
    assert fares.transit_fare([sub]) == 1550                      # 10km 안
    assert fares.transit_fare([sub, bus]) == 1550 + 100           # 15km → 5km마다 100원
    assert fares.transit_fare([bus, night]) == 2500               # 가장 비싼 기본요금 (10km 안)
    assert fares.transit_fare([{"type": "walk", "sec": 60}]) == 0

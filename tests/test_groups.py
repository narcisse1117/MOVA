"""모임 택시: 내리는 곳 기준 정산, 실제 금액 나누기, 묶기."""
import groups


def test_settle_segments_shared_by_riders():
    # 미터기 9,000 → 15,000 → 21,000: 첫 구간 3명, 둘째 2명, 셋째 1명
    stops = [{"member": 0, "meter": 9000}, {"member": 1, "meter": 15000}, {"member": 2, "meter": 21000}]
    shares, payer = groups.settle(stops)
    assert payer == 2
    assert shares[0] == 3000
    assert shares[1] == 3000 + 3000
    assert shares[2] == 21000 - shares[0] - shares[1]          # 남는 돈은 낸 사람이
    assert sum(shares.values()) == 21000


def test_settle_actual_with_meters_matches_hand_calc():
    shares, payer = groups.settle_actual([28500, 33300, 36800], 38400, [27800, 33100, 38400])
    assert payer == 2
    assert shares == [9270, 11920, 17210]
    assert sum(shares) == 38400


def test_settle_actual_total_only_scales_estimate():
    shares, payer = groups.settle_actual([28500, 33300, 36800], 38600)
    assert sum(shares) == 38600
    assert shares[0] < shares[1] < shares[2]                    # 먼저 내린 사람이 적게


def test_settle_single_rider_pays_all():
    shares, payer = groups.settle_actual([12000], 13300)
    assert shares == [13300] and payer == 0


def test_plan_taxis_groups_by_direction():
    meet = (37.497952, 127.027619)                              # 강남역
    homes = [(37.655128, 127.061368), (37.668, 127.044), (37.638, 127.0257),   # 북쪽: 노원·도봉·수유
             (37.484201, 126.929715), (37.4825, 126.9417), (37.557192, 126.925381)]  # 서쪽: 신림·봉천·홍대
    taxis = groups.plan_taxis(meet, homes, 86400 + 3600)
    assert all(len(t["order"]) <= groups.MAX_PER_TAXI for t in taxis)
    assert sorted(m for t in taxis for m in t["order"]) == list(range(6))   # 모두 한 번씩
    north = {0, 1, 2}
    for t in taxis:
        s = set(t["order"])
        assert s <= north or not (s & north)                    # 북쪽·서쪽이 섞이지 않는다
        assert sum(t["shares"].values()) == t["total_fare"]

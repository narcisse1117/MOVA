"""
테스트 공통 설정.

- 네이버·버스 실시간 같은 바깥 API는 부르지 않는다 (무료 한도를 쓰지 않고, 결과가 매번 같게)
- prep/out 데이터가 없는 환경(예: 새로 받은 레포)에서는 엔진 테스트를 건너뛴다
실행:  python -m pytest -q      (레포 최상위에서)
"""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
sys.path.insert(0, ROOT)

HAS_DATA = os.path.exists(os.path.join(ROOT, "prep", "out", "stop_times.csv"))
needs_data = pytest.mark.skipif(not HAS_DATA, reason="prep/out 데이터 없음")


@pytest.fixture(autouse=True)
def no_external_api(monkeypatch):
    import naver
    import realtime
    monkeypatch.setattr(naver, "route", lambda *a, **k: None)
    monkeypatch.setattr(naver, "geocode", lambda *a, **k: [])
    monkeypatch.setattr(naver, "reverse", lambda *a, **k: None)
    monkeypatch.setattr(naver, "local_search", lambda *a, **k: [])
    monkeypatch.setattr(realtime, "arrivals", lambda *a, **k: None)
    monkeypatch.setattr(realtime, "subway_arrivals", lambda *a, **k: None)


@pytest.fixture(scope="session")
def net_wd():
    import network
    return network.load("WD")

# server: API 서버 (FastAPI)

경로 엔진(`engine/`)을 HTTP로 연다. 프론트는 이 API만 쓰면 된다.

## 실행

```
pip install fastapi==0.115.6 uvicorn==0.32.1 pandas numpy scipy
python -m uvicorn server.app:app --reload --port 8000
```

- 레포 최상위 폴더에서 실행한다. `prep/out/` 결과와 `데이터/`(공식 버스 시각)가 있어야 한다
- API 문서(자동 생성): http://localhost:8000/docs
- 요일 유형(평일·토·공휴일)마다 첫 요청 때 노선망을 읽는다 (캐시가 있으면 1초 안, 없으면 40초쯤)
- 응답 예시: `server/examples/*.json` (`python server/make_examples.py`로 다시 만든다)

## 공통 규칙

- **좌표:** `{"lat": 37.55, "lng": 126.92, "label": "홍대입구역"}`. `label`은 화면 표시용이라 빼도 된다. 1차 범위는 서울
- **시각:** 요청은 `2026-11-09T23:30`처럼 서울 시각. 응답은 `2026-11-10T00:30:00+09:00`
- **운행일:** 03시 전은 전날 운행일로 본다. 응답의 `service_day`, `day_type`(`WD`/`SAT`/`HOL`)으로 알 수 있다
- **구간(`legs`) 종류:** `walk`(걷기, `duration_sec`), `subway`, `bus`(`line`, `departure`, `arrival`, `stops`, 버스는 `headway_min`), `taxi`(`wait_sec`, `drive_sec`, `distance_m`, `fare`, `fare_range`, `estimated`)

## API

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| GET | `/api/config` | 서비스 이름 등 (`config/app.json`) |
| GET | `/api/health` | 서버 상태 |
| POST | `/api/routes` | F1·F2: 택시 직행 / 대중교통만 / 조합 |
| POST | `/api/deadline` | F3: 출발 마감 시각 |
| POST | `/api/groups` | 모임 만들기 → `id`, `share_path` |
| POST | `/api/groups/{id}/members` | 멤버 추가 (닉네임, 집 좌표) |
| GET | `/api/groups/{id}` | 모임 + 멤버별 출발 마감 (모임 장소 → 집, 마감이 빠른 순) |

### `POST /api/routes`

```json
{"origin": {"lat": 37.557192, "lng": 126.925381, "label": "홍대입구역"},
 "destination": {"lat": 37.655128, "lng": 127.061368, "label": "노원역"},
 "departure_time": "2026-11-10T00:30"}
```

응답 `options`: `kind`가 `taxi`(택시 직행) / `transit`(대중교통만, 탈것 수별로 여러 개일 수 있음) / `combo`(조합, `recommended: true`가 추천, `combo_kind`는 `taxi_last` 마지막 택시 / `taxi_first` 처음 택시 / `taxi_both` 양쪽). 각 항목에 `arrival`, `duration_min`, `fare`, `fare_detail{transit, taxi}`, `legs`.

### `POST /api/deadline`

```json
{"origin": {...}, "destination": {...}, "from_time": "2026-11-09T21:00"}
```

응답: `regular`(지하철·일반버스 막차 기준), `night`(심야버스 포함, 150분 이내 경로). 각각 `leave_by`(안내 시각, 5분 여유), `latest`(마지막 가능), `all_night`, `route`. 갈 수 없으면 `null`.

### 모임

1. `POST /api/groups` `{"name": "송년회", "meeting_place": {...}, "date": "2026-12-18"}` → `{"id": "...", "share_path": "/g/..."}`
2. 링크를 받은 사람마다 `POST /api/groups/{id}/members` `{"nickname": "민수", "home": {...}}`
3. `GET /api/groups/{id}` → `members[].deadline` (위 deadline과 같은 모양). 마감 계산은 모임 날짜 21:00 이후 기준

`taxi_groups`(같은 방향 택시 묶기), `settlement`(정산)는 아직 `null`이다.

## 아직 없는 것

- 택시 묶기, 하차 지점 기준 정산, 송금 앱 링크
- 인증·수정·삭제, 요청 제한
- 첫 구간 실시간 버스 도착 반영
- 배포 (지금은 SQLite 파일 `server/data/mova.db`)

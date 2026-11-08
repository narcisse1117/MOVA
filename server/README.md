# server: API 서버 (FastAPI)

경로 엔진(`engine/`)을 HTTP로 연다. 프론트는 이 API만 쓰면 된다.

## 실행

```
pip install fastapi==0.115.6 uvicorn==0.32.1 pandas numpy scipy
python -m uvicorn server.app:app --reload --port 8000
```

- 레포 최상위 폴더에서 실행한다. `prep/out/` 결과와 `데이터/`(공식 버스 시각)가 있어야 한다
- API 문서(자동 생성): http://localhost:8000/docs
- 네이버 키: `데이터/naver_key.txt` (첫 줄 Client ID, 둘째 줄 Secret). 없으면 택시는 추정으로만 계산한다
- 요일 유형(평일·토·공휴일)마다 첫 요청 때 노선망을 읽는다 (캐시가 있으면 1초 안, 없으면 40초쯤)
- 응답 예시: `server/examples/*.json` (`python server/make_examples.py`로 다시 만든다)

## 공통 규칙

- **좌표:** `{"lat": 37.55, "lng": 126.92, "label": "홍대입구역"}`. `label`은 화면 표시용이라 빼도 된다. 1차 범위는 서울
- **시각:** 요청은 `2026-11-09T23:30`처럼 서울 시각. 응답은 `2026-11-10T00:30:00+09:00`
- **운행일:** 03시 전은 전날 운행일로 본다. 응답의 `service_day`, `day_type`(`WD`/`SAT`/`HOL`)으로 알 수 있다
- **구간(`legs`) 종류:** `walk`(걷기, `duration_sec`), `subway`, `bus`(`line`, `departure`, `arrival`, `stops`, 버스는 `headway_min`), `taxi`(`wait_sec`, `drive_sec`, `distance_m`, `fare`, `fare_range`, `source`: `naver_live` 네이버 실시간 / `naver` 네이버 거리 + 심야 속도 / `estimate` 직선거리 추정)

## API

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| GET | `/api/config` | 서비스 이름 등 (`config/app.json`) |
| GET | `/api/health` | 서버 상태 |
| POST | `/api/routes` | F1·F2: 택시 직행 / 대중교통만 / 조합 |
| POST | `/api/deadline` | F3: 출발 마감 시각 |
| POST | `/api/groups` | 모임 만들기 → `id`, `share_path` |
| POST | `/api/groups/{id}/members` | 멤버 추가 (닉네임, 집 좌표) |
| GET | `/api/groups/{id}?leave_at=...` | 모임 + 멤버별 출발 마감 (마감이 빠른 순). `leave_at`(모임 끝나는 시각)을 주면 택시 묶기 + 정산 |

### `POST /api/routes`

```json
{"origin": {"lat": 37.557192, "lng": 126.925381, "label": "홍대입구역"},
 "destination": {"lat": 37.655128, "lng": 127.061368, "label": "노원역"},
 "departure_time": "2026-11-10T00:30"}
```

출발이 지금부터 20분 안이면 `live: true`이고, 버스 구간에 `realtime`이 붙는다: `status`(`ok`/`later`/`earlier`/`missed`/`ended`/`unknown`), `arrive_in_sec`, `realtime_dep`, `delay_sec`(엔진 예정 대비), `is_last`(막차), `message`, `plate`. 예시: `server/examples/routes_live_now.json`.

응답 `options`: `kind`가 `taxi`(택시 직행) / `transit`(대중교통만, 탈것 수별로 여러 개일 수 있음) / `combo`(조합, `recommended: true`가 추천, `combo_kind`는 `taxi_last` 마지막 택시 / `taxi_first` 처음 택시 / `taxi_both` 양쪽). 각 항목에 `arrival`, `duration_min`, `fare`, `fare_detail{transit, taxi}`, `legs`.

### `POST /api/deadline`

```json
{"origin": {...}, "destination": {...}, "from_time": "2026-11-09T21:00"}
```

응답: `regular`(지하철·일반버스 막차 기준), `night`(심야버스 포함, 150분 이내 경로). 각각 `leave_by`(안내 시각, 5분 여유), `latest`(마지막 가능), `all_night`, `route`. 갈 수 없으면 `null`.

### 모임

1. `POST /api/groups` `{"name": "송년회", "meeting_place": {...}, "date": "2026-12-18"}` → `{"id": "...", "share_path": "/g/..."}`
2. 링크를 받은 사람마다 `POST /api/groups/{id}/members` `{"nickname": "민수", "home": {...}, "toss_id": "선택"}`
3. `GET /api/groups/{id}` → `members[].deadline` (위 deadline과 같은 모양). 마감 계산은 모임 날짜 21:00 이후 기준
4. `GET /api/groups/{id}?leave_at=2026-12-19T01:00` → 위에 더해
   - `taxi_groups[]`: 그 시각에 지하철·일반버스 막차가 끊긴 사람끼리 묶은 택시. `riders[]`는 내리는 순서이고 각자 `arrival`, `meter_at_dropoff`(내릴 때 미터기), `share`(낼 몫), `solo_fare`(혼자 탔으면), `saving`. `payer`는 마지막에 내려 택시비를 내는 사람
   - `settlement[]`: 누가 누구에게 얼마 보내는지. 받는 사람이 `toss_id`를 등록했으면 `toss_link`(`https://toss.me/아이디/금액`)

묶기·정산 규칙 (`engine/groups.py`)
- 한 차 4명까지. 합쳤을 때 택시비가 가장 많이 줄어드는 묶음부터 합친다. 혼자 갈 때보다 20분 넘게 늦어지는 사람이 생기면 안 합친다
- 내리는 순서는 가능한 순서를 모두 비교해 택시비가 가장 싼 순서
- 정산: 미터기를 구간(사람이 내릴 때마다)으로 나누고, 구간 요금은 그 구간에 타고 있던 사람끼리 똑같이 나눈다. 1인 몫은 10원 단위, 남는 돈은 내는 사람 몫
- 택시마다 네이버 실제 경로(모임 장소 → 집들, 경유지)로 미터기를 계산한다 (`source`). `solo_fare`는 추정이라 `saving`은 참고용
- 토스 `toss.me/아이디/금액` 링크 형식은 실제 앱에서 한 번 확인해야 한다. 카카오페이는 금액을 넣은 송금 링크를 만들 수 없어서 아직 없다

## 아직 없는 것

- 택시를 탈 사람을 직접 고르기 (지금은 막차 끊긴 사람 전부), 카카오페이 송금
- 인증·수정·삭제, 요청 제한
- 지하철 실시간, 실시간으로 뒤 구간 시각 다시 계산
- 배포 (지금은 SQLite 파일 `server/data/mova.db`)

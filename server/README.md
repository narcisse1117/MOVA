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
- **운행일:** 03시 전은 전날 운행일로 본다. 03~05시 출발은 전날 밤(심야버스)과 새 날(첫차·첫 버스)을 둘 다 찾아보고 더 빨리 도착하는 쪽을 쓴다. 응답의 `service_day`, `day_type`(`WD`/`SAT`/`HOL`)으로 알 수 있다. 출발 시각은 하루 중 언제든 된다
- **구간(`legs`) 종류:** `walk`(걷기, `duration_sec`), `subway`, `bus`(`line`, `departure`, `arrival`, `stops`, 버스는 `headway_min`), `taxi`(`wait_sec`, `drive_sec`, `distance_m`, `fare`, `fare_range`, `source`: `naver_live` 네이버 실시간 / `naver` 네이버 거리 + 심야 속도 / `estimate` 직선거리 추정)

## 접근 제한

- **CORS:** `config/app.json`의 `cors_origins`(지금은 localhost 5173·3000)와 `cors_origin_regex`(`*.vercel.app`)에서만 브라우저로 부를 수 있다. 프론트 실제 주소가 정해지면 `cors_origins`에 추가하고 서버를 재시작한다
- **요청 제한 (IP별):** 무거운 요청(`/api/routes`, `/api/deadline`, `GET /api/groups/{id}`)은 1분 20번·하루 300번, 나머지는 1분 60번·하루 3,000번. 넘으면 `429` + `retry_after_sec`. 숫자는 `config/app.json`의 `rate_limits`
- **네이버 호출:** 하루 1,900건·한 달 55,000건을 넘으면 그날(그달)은 택시를 추정으로 계산한다 (서비스는 계속 됨). 사용량은 `GET /api/health`의 `naver_calls`

## API

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| GET | `/api/config` | 서비스 이름 등 (`config/app.json`) |
| GET | `/api/health` | 서버 상태 |
| GET | `/api/geocode?q=...` | 검색어 → 후보 (`kind`: `station` 역 / `place` 가게·장소 / `address` 주소), `region`·`in_seoul` 포함. 서울 안이 먼저, 최대 10개 |
| GET | `/api/reverse?lat=&lng=` | 좌표 → 표시 이름 (`label`: "노원구 상계동") |
| POST | `/api/routes` | F1·F2: 택시 직행 / 대중교통만 / 조합 |
| POST | `/api/deadline` | F3: 출발 마감 시각 |
| POST | `/api/groups` | 모임 만들기 → `id`, `share_path` |
| POST | `/api/groups/{id}/members` | 멤버 추가 (닉네임, 집 좌표) |
| POST | `/api/settle` | 내린 뒤 실제 택시비로 나누기 (총액만, 또는 내릴 때 미터기까지). 송금은 각자 |
| GET | `/api/groups/{id}?leave_at=...` | 모임 + 멤버별 출발 마감 (마감이 빠른 순). `leave_at`(모임 끝나는 시각)을 주면 택시 묶기 + 정산 |

### 장소 검색 (`/api/geocode`, `/api/reverse`)

- 역 이름(“강남역”, “잠실”)은 우리 역 목록, 도로명·지번 주소(“노원구 상계로 69”)는 네이버 Geocoding, 가게·장소 이름(“스타벅스 강남”, “강남역 고기집”)은 **네이버 지역 검색**(NAVER API HUB, 최대 5개, `category` 포함)
- 호출 절약: 역 이름이 정확히 맞거나 주소로 찾아지면 지역 검색은 부르지 않는다. 지역 검색 키는 `데이터/naver_search_key.txt` (택시 경로 키와 다름), 하루 20,000건 상한 (네이버 한도 25,000)
- 지도에서 핀을 찍은 좌표는 `/api/reverse`로 이름을 붙인다
- 결과는 `engine/cache/naver.sqlite`에 저장해서 같은 검색은 다시 부르지 않는다. 무료 월 300만 건
- 결과마다 `region`(“서울 강남구”, “경기 성남시 분당구”)과 `in_seoul`. **서울 밖도 돌려주고** `in_seoul: false`로 표시한다 → 프론트는 서울 밖을 고르면 안내 화면(E1)으로 보낸다. 서울 밖만 찾으면 `notes`에 안내 문구
- 예시: `server/examples/geocode_gangnam.json`, `geocode_place.json`, `geocode_outside.json`

### `POST /api/routes`

```json
{"origin": {"lat": 37.557192, "lng": 126.925381, "label": "홍대입구역"},
 "destination": {"lat": 37.655128, "lng": 127.061368, "label": "노원역"},
 "departure_time": "2026-11-10T00:30"}
```

`departure_time`은 세 가지 다 받는다 (`/api/deadline`의 `from_time`도 같음):
- `"now"` 또는 생략 → 지금
- `"23:40"`처럼 시:분만 → **오늘 밤** 기준. 03시 전(`"00:30"`)은 다음 날 새벽. 그 시각이 지금보다 30분 넘게 지났으면 다음 날 밤 (예: 화 00:10에 `"23:40"` → 화 23:40)
- `"2026-11-10T00:30"` → 그대로

S1 화면의 출발 시각 값(`"now"`, `"23:40"`)을 그대로 보내면 된다. 서버가 정한 실제 시각은 응답 `departure`에 나온다.

출발이 지금부터 20분 안이면 `live: true`이고, 첫 탈것(버스·지하철) 구간에 `realtime`이 붙는다 (지하철은 `matched`: `train` 같은 열차 / `direction` 같은 행선지): `status`(`ok`/`later`/`earlier`/`missed`/`ended`/`unknown`), `arrive_in_sec`, `realtime_dep`, `delay_sec`(엔진 예정 대비), `is_last`(막차), `message`, `plate`. 예시: `server/examples/routes_live_now.json`.

응답 `options`: 추천(`recommended: true`)은 택시 직행보다 15분(`config/fares.json` `choice.recommend_max_delay_min`) 넘게 늦지 않는 안 중 가장 많이 아끼는 안, 없으면 가장 싼 안(대중교통만일 수 있음). 조합은 최대 2안. `kind`가 `taxi`(택시 직행) / `transit`(대중교통만, 탈것 수별로 여러 개일 수 있음) / `combo`(조합, `recommended: true`가 추천, `combo_kind`는 `taxi_last` 마지막 택시 / `taxi_first` 처음 택시 / `taxi_both` 양쪽). 각 항목에 `arrival`, `duration_min`, `fare`, `fare_detail{transit, taxi}`, `legs`.

결과 화면(S2·S3)용 값:
- 카드마다 `option_id`(`taxi`, `transit-1`, `combo-1` …, S3 주소 `/result/:optionId`에 쓴다), `available`, `fare_range[최소, 최대]`(대중교통 요금 + 택시 구간 범위), `saving_vs_taxi`(택시 직행 대비 절약액, 요금 범위 가운데 값끼리), `delay_vs_taxi_min`(택시 직행보다 늦어지는 분, 빠르면 음수)
- `warnings[]`: `code`가 `TIGHT_TRANSFER`(갈아탈 여유 3분 이하, `at` 역·정류장, `slack_sec`, `fallback_taxi{from, fare, fare_range}` 놓치면 그 자리에서 택시), `BUS_ESTIMATE`(버스 시각 일부 추정), `NO_TRAFFIC`(택시를 교통 정보 없이 계산). 모두 `message`(화면에 그대로 써도 되는 문장)가 있다
- 버스·지하철 구간: `night`(심야버스), `is_last`(시간표 기준 그 정류장 막차), `timetable`(`official` 지하철 시간표 / `observed` 심야버스 실측 / `estimate` 배차 간격 추정)
- 대중교통만으로 갈 수 없으면 `{"kind": "transit", "option_id": "transit-none", "available": false, "reason": "LAST_TRAIN_GONE", "message": "대중교통 막차가 00:29에 끊겼어요"}` 카드가 붙는다 → 흐리게 표시
- 응답 `last_service`: `regular_last_departure`(지하철·일반버스 막차 출발 시각, 심야버스 제외), `regular_cut`(지금 출발 시각에 이미 끊김 → "막차 끊김" 표시), `all_night`(04시까지 계속 감)
- 응답 `data_as_of`: `bus_official`(버스 첫차·막차를 받은 날), `night_bus`(심야버스 실측 밤), `night_bus_day_type_match`(같은 요일 유형 기록인지)

### `POST /api/deadline`

```json
{"origin": {...}, "destination": {...}, "from_time": "2026-11-09T21:00"}
```

응답: `regular`(지하철·일반버스 막차 기준), `night`(심야버스 포함, 150분 이내 경로). 각각 `leave_by`(안내 시각, 5분 여유), `latest`(마지막 가능), `all_night`, `route`. 갈 수 없으면 `null`.

### 모임

1. `POST /api/groups` `{"name": "송년회", "meeting_place": {...}, "departure_time": "23:00"}` (이름은 선택, 시각은 `"now"`·`"23:40"`·ISO, 생략하면 지금) → `{"id": 16자, "share_path": "/g/...", "admin_token", "departure", "expires_at"}`. **`admin_token`은 만든 사람 브라우저에만 저장** (다시 받을 수 없음)
2. 링크를 받은 사람마다 `POST /api/groups/{id}/members` `{"nickname": "민수", "home": {...}}` → `{"id", "nickname", "member_token", "area"}`. 닉네임이 겹치면 `민수2`처럼 번호를 붙여 돌려준다. **`member_token`은 그 사람 브라우저에 모임별로 저장**. 만든 사람이 대신 넣을 때는 관리 토큰을 함께 보낸다(`by_admin: true`)
3. `GET /api/groups/{id}` → `status`(`ready` / `expired`), `version`(참여자가 바뀔 때마다 +1, 폴링에서 같으면 다시 그리지 않아도 됨), `is_admin`, `members[]`
   - 각 사람: `nickname`, `area`(동 이름 · 가까운 역, 예: `노원구 상계동 · 노원역 근처`), `is_me`, `deadline`(위 deadline과 같은 모양). **다른 사람의 집 주소·좌표는 안 온다.** 본인 토큰으로 요청할 때만 자기 `home`이 온다
   - `deadline.regular.extra_if_late`: `{"amount", "taxi_fare", "message": "이 시각을 넘기면 25,300원 더 들어요 (택시 직행 추정)"}`, 심야버스로 더 갈 수 있으면 `night_bus_fare`, `night_bus_until`
   - 마감 계산은 모임 출발 예정 시각부터
4. `GET /api/groups/{id}?leave_at=2026-12-19T01:00` → 위에 더해
   - `taxi_groups[]`: 그 시각에 지하철·일반버스 막차가 끊긴 사람끼리 묶은 택시. `riders[]`는 내리는 순서이고 각자 `arrival`, `meter_at_dropoff`(내릴 때 미터기), `share`(낼 몫), `solo_fare`(혼자 탔으면), `saving`. `payer`는 마지막에 내려 택시비를 내는 사람
   - `taxi_groups[].estimated_meters`: 내릴 때 예상 미터기 (내린 순서)
   - `settlement[]`: 누가 누구에게 얼마 보내는지 **예상값** (`estimated: true`)
5. 택시에서 내린 뒤 `POST /api/settle`로 실제 금액을 나눈다 (아래)
6. 고치기·빠지기·끝내기 (토큰은 `Authorization: Bearer <토큰>` 헤더)
   - `PATCH /api/groups/{id}/members/{member_id}` `{"nickname"?, "home"?}`: 본인(참여자 토큰) 또는 만든 사람(관리 토큰)
   - `DELETE /api/groups/{id}/members/{member_id}`: 빠지기(본인) / 참여자 삭제(만든 사람). 주소도 바로 지운다
   - `DELETE /api/groups/{id}`: 모임 끝내기(만든 사람만). 참여자 주소를 바로 지운다
   - 만든 지 24시간이 지나면 참여자(집 주소)를 자동으로 지우고 `status: "expired"`로 남는다 (7일 뒤 기록도 삭제). 끝난 모임에 참여하면 410
   - 토큰은 서버에 원문 없이 해시만 저장한다. 인원 제한은 없다

### `POST /api/feedback` (도착 후 실제 택시비, F2-09)

`{"option_id": "combo-1", "option_kind": "combo", "fare_range": [9400, 10600], "actual_fare": 10200, "distance_m": 7200, "departure": "2026-11-19T00:30"}` → `{"saved": true, "within_range": true}`. 건너뛰면 `{"skipped": true}`. 주소는 받지 않고 거리대(`~5km` 등)·시간대(시)만 남긴다

### `POST /api/events` (사용 기록)

`{"device_id": "브라우저에서 만든 임의 값", "name": "search", "area": "마포구 서교동", "option_kind": "combo"}` → `{"saved": true}`. 동 이름까지만 (주소 금지)

묶기·정산 규칙 (`engine/groups.py`)
- 한 차 4명까지. 합쳤을 때 택시비가 가장 많이 줄어드는 묶음부터 합친다. 혼자 갈 때보다 20분 넘게 늦어지는 사람이 생기면 안 합친다
- 내리는 순서는 가능한 순서를 모두 비교해 택시비가 가장 싼 순서
- 정산: 미터기를 구간(사람이 내릴 때마다)으로 나누고, 구간 요금은 그 구간에 타고 있던 사람끼리 똑같이 나눈다. 1인 몫은 10원 단위, 남는 돈은 내는 사람 몫
- 택시마다 네이버 실제 경로(모임 장소 → 집들, 경유지)로 미터기를 계산한다 (`source`). `solo_fare`는 추정이라 `saving`은 참고용
- 송금은 서비스가 하지 않는다. 금액만 계산해서 보여주고 각자 보낸다 (송금 링크도 만들지 않음)

### `POST /api/settle` (내린 뒤 실제 금액)

```json
{"riders": [{"nickname": "철수", "estimated_meter": 28500},
            {"nickname": "민수", "estimated_meter": 33300},
            {"nickname": "수진", "estimated_meter": 36800}],
 "total_fare": 38600}
```
- `riders`는 내린 순서. 마지막 사람이 택시비를 낸 사람
- **총액만** 넣으면 예상 미터기 비율대로 늘이거나 줄여서 나눈다 (`method: estimated_ratio`). 예상도 없으면 구간을 똑같이 본다
- 각자 **내릴 때 미터기 금액**(`actual_meter`)까지 넣으면 그대로 구간을 나눈다 (`method: actual_meters`, 가장 정확)
- 응답: `shares`(각자 몫), `transfers`(누가 누구에게 얼마). 예시: `server/examples/settle_total_only.json`, `settle_actual_meters.json`

## 아직 없는 것

- 택시를 탈 사람을 직접 고르기 (지금은 막차 끊긴 사람 전부)
- 실시간으로 뒤 구간 시각 다시 계산
- 배포 (지금은 SQLite 파일 `server/data/mova.db`)

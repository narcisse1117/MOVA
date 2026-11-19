// 서버 없이 화면을 만들 때 쓰는 예시 응답 (server/examples/*.json을 그대로 가져옴)
// VITE_API_BASE를 비워 두면 api/index.js가 이 파일을 쓴다.
import routesLive from './fixtures/routes_live.json'
import routesNight from './fixtures/routes_night.json'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// /api/geocode 응답의 results와 같은 모양
const PLACES = [
  {
    kind: 'station',
    label: '강남역',
    address: '2호선, 신분당선',
    lat: 37.497718,
    lng: 127.027914,
    region: '서울 강남구',
    in_seoul: true,
  },
  {
    kind: 'station',
    label: '홍대입구역',
    address: '2호선, 경의중앙선, 공항철도',
    lat: 37.557192,
    lng: 126.925381,
    region: '서울 마포구',
    in_seoul: true,
  },
  {
    kind: 'station',
    label: '사당역',
    address: '2호선, 4호선',
    lat: 37.47653,
    lng: 126.981685,
    region: '서울 동작구',
    in_seoul: true,
  },
  {
    kind: 'station',
    label: '수유역',
    address: '4호선',
    lat: 37.638052,
    lng: 127.025732,
    region: '서울 강북구',
    in_seoul: true,
  },
  {
    kind: 'station',
    label: '노원역',
    address: '4호선, 7호선',
    lat: 37.655128,
    lng: 127.061368,
    region: '서울 노원구',
    in_seoul: true,
  },
  {
    kind: 'station',
    label: '쌍문역',
    address: '4호선',
    lat: 37.648627,
    lng: 127.034709,
    region: '서울 도봉구',
    in_seoul: true,
  },
  {
    kind: 'place',
    label: '수유시장',
    address: '서울특별시 강북구 도봉로 279',
    lat: 37.63751,
    lng: 127.02371,
    region: '서울 강북구',
    in_seoul: true,
  },
  {
    kind: 'address',
    label: '노원구 상계로 69',
    address: '서울특별시 노원구 상계로 69',
    lat: 37.65467,
    lng: 127.06094,
    region: '서울 노원구',
    in_seoul: true,
  },
  {
    kind: 'station',
    label: '정자역',
    address: '분당선, 신분당선',
    lat: 37.367124,
    lng: 127.108238,
    region: '경기 성남시 분당구',
    in_seoul: false,
  },
  {
    kind: 'station',
    label: '수원역',
    address: '1호선, 수인분당선',
    lat: 37.265981,
    lng: 126.999743,
    region: '경기 수원시 팔달구',
    in_seoul: false,
  },
]

export async function mockGeocode(q) {
  await wait(150)
  const key = q.replace(/\s/g, '')
  const results = PLACES.filter((p) =>
    (p.label + p.address + p.region).replace(/\s/g, '').includes(key),
  )
    .sort((a, b) => Number(b.in_seoul) - Number(a.in_seoul))
    .slice(0, 10)
  const notes =
    results.length > 0 && results.every((r) => !r.in_seoul)
      ? ['서울 밖 장소만 찾았어요. 지금은 서울 안 출발·도착만 안내해요']
      : []
  return { query: q, results, notes }
}

export async function mockReverse() {
  await wait(150)
  return { label: '강남구 역삼동', lat: 37.4979, lng: 127.0276 }
}

/** 지금 출발이면 실시간 예시, 시각을 고르면 심야 예시 */
export async function mockRoutes(body) {
  await wait(900)
  return structuredClone(body.departure_time === 'now' ? routesLive : routesNight)
}

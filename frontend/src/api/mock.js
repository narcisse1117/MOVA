// 서버 없이 화면을 만들 때 쓰는 예시 응답 (server/examples/*.json을 그대로 가져옴)
// VITE_API_BASE를 비워 두면 api/index.js가 이 파일을 쓴다.
import { ApiError } from './client.js'
import groupGet from './fixtures/group_get.json'
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

const randomId = (n) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.charAt(b % 56),
  ).join('')

/** 서울 시각 ISO ('2026-11-19T23:00:00+09:00') */
function seoulIso(date) {
  const s = new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19)
  return `${s}+09:00`
}

// 이 브라우저에서 만든 모임을 서버 대신 기억 (새로고침해도 유지)
const MOCK_GROUPS_KEY = 'mova:mockGroups'

function readMockGroups() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_GROUPS_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function writeMockGroup(group) {
  try {
    localStorage.setItem(
      MOCK_GROUPS_KEY,
      JSON.stringify({ ...readMockGroups(), [group.id]: group }),
    )
  } catch {
    // 저장이 막혀 있으면 이번 탭에서만 동작
  }
}

const notFound = () => new ApiError('끝났거나 없는 모임이에요', { status: 404 })

/** POST /api/groups 예시 응답 (README 모양) */
export async function mockCreateGroup(body) {
  await wait(500)
  const id = randomId(16)
  const now = new Date()
  // README: "23:40"처럼 시:분만 오면 오늘 밤 기준, 03시 전은 다음 날 새벽
  let departure = seoulIso(now)
  const hm = /^(\d{2}):(\d{2})$/.exec(body.departure_time ?? '')
  if (hm) {
    const day = seoulIso(now).slice(0, 10)
    const next =
      Number(hm[1]) < 3 ? seoulIso(new Date(now.getTime() + 24 * 3600 * 1000)).slice(0, 10) : day
    departure = `${next}T${hm[1]}:${hm[2]}:00+09:00`
  }
  const expiresAt = seoulIso(new Date(now.getTime() + 24 * 3600 * 1000))
  writeMockGroup({
    id,
    name: body.name ?? null,
    meeting_place: body.meeting_place,
    departure,
    expires_at: expiresAt,
    members: [],
  })
  return {
    id,
    share_path: `/g/${id}`,
    admin_token: `adm_${randomId(24)}`,
    departure,
    expires_at: expiresAt,
    name: body.name ?? null,
  }
}

/**
 * GET /api/groups/{id} 예시 응답
 * - 이 브라우저에서 만든 모임: 기억해 둔 값 (마감 시각 없이 이름·장소·참여자만)
 * - EXAMPLEgroupID16: server/examples/group_get.json 그대로
 */
export async function mockGetGroup(groupId) {
  await wait(400)
  if (groupId === groupGet.id) return structuredClone(groupGet)
  const group = readMockGroups()[groupId]
  if (!group) throw notFound()
  const expired = new Date(group.expires_at) < new Date()
  return {
    id: group.id,
    name: group.name,
    status: expired ? 'expired' : 'ready',
    version: group.members.length + 1,
    is_admin: false,
    departure: group.departure,
    expires_at: group.expires_at,
    meeting_place: group.meeting_place,
    members: expired
      ? []
      : group.members.map((m) => ({ id: m.id, nickname: m.nickname, area: m.area, is_me: false })),
  }
}

/** POST /api/groups/{id}/members 예시 응답 */
export async function mockJoinGroup(groupId, body) {
  await wait(400)
  const group = readMockGroups()[groupId]
  // README: 닉네임이 겹치면 '민수2'처럼 번호를 붙여 돌려준다
  const taken = new Set(group?.members.map((m) => m.nickname) ?? [])
  let nickname = body.nickname
  for (let n = 2; taken.has(nickname); n += 1) nickname = `${body.nickname}${n}`
  const member = { id: `m_${randomId(8)}`, nickname, area: `${body.home.label} 근처` }
  if (group) writeMockGroup({ ...group, members: [...group.members, member] })
  return { ...member, member_token: `mem_${randomId(24)}` }
}

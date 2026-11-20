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

// ── 모임 (server/README.md '모임'과 같은 모양) ──
// 서버 대신 이 브라우저에 모임을 기억해 둔다 (새로고침해도 유지). 다른 브라우저·기기에서는 보이지 않는다.
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

function findMockGroup(groupId) {
  const group = readMockGroups()[groupId]
  if (!group || group.ended) throw new ApiError('끝났거나 없는 모임이에요', { status: 404 })
  if (new Date(group.expires_at) < new Date()) {
    throw new ApiError('끝났거나 없는 모임이에요', { status: 410 })
  }
  return group
}

const MIN = 60 * 1000

/** ISO 시각을 ms만큼 옮김 (서울 시각 문자열로) */
const shiftIso = (iso, ms) => seoulIso(new Date(new Date(iso).getTime() + ms))

/** 객체 안의 모든 시각 문자열을 ms만큼 옮김 */
function shiftTimes(value, ms) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return shiftIso(value, ms)
  }
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, ms))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftTimes(v, ms)]))
  }
  return value
}

/** 운행일 시작(05시 기준) ms — 새벽은 전날 밤으로 */
const serviceDayStart = (iso) => {
  const day = seoulIso(new Date(new Date(iso).getTime() - 5 * 3600 * 1000)).slice(0, 10)
  return new Date(`${day}T00:00:00+09:00`).getTime()
}

/**
 * 참여자별 출발 마감 — 서버 예시(group_get.json)의 마감 두 개를 돌려 쓴다.
 * 막차 시각(00:20 무렵)은 그대로 두고 날짜만 모임 날로 옮겨서, 늦게 출발하는 모임은 택시로 묶이게 하고
 * 사람마다 7분씩 다르게 한다
 */
function mockDeadline(group, index) {
  const template = groupGet.members[index % groupGet.members.length].deadline
  const offset =
    serviceDayStart(group.departure) - serviceDayStart(groupGet.departure) + index * 7 * MIN
  return shiftTimes(template, offset)
}

const round10 = (won) => Math.round(won / 10) * 10

/**
 * README 정산 규칙: 미터기를 내릴 때마다 구간으로 나누고, 구간 요금은 그때 타고 있던 사람끼리 똑같이.
 * 1인 몫은 10원 단위, 남는 돈은 내는 사람(마지막) 몫
 * @param {number[]} meters 내린 순서대로 내릴 때 미터기
 */
function splitMeters(meters) {
  const n = meters.length
  const shares = meters.map((_, j) => {
    let sum = 0
    for (let s = 0; s <= j; s += 1) sum += (meters[s] - (s ? meters[s - 1] : 0)) / (n - s)
    return round10(sum)
  })
  const total = meters[n - 1]
  shares[n - 1] = total - shares.slice(0, -1).reduce((a, b) => a + b, 0)
  return shares
}

/** leave_at에 막차(지하철·일반버스)가 끊긴 사람끼리 4명씩 택시로 묶음 */
function mockTaxiGroups(members, leaveAt) {
  const leave = new Date(`${leaveAt}:00+09:00`)
  const cut = members.filter(
    (m) => !m.deadline.regular || new Date(m.deadline.regular.latest) < leave,
  )
  const groups = []
  for (let i = 0; i < cut.length; i += 4) {
    const riders = cut.slice(i, i + 4)
    const meters = riders.map((_, k) => 16000 + 6400 * (k + 1) + i * 300)
    const shares = splitMeters(meters)
    const payer = riders[riders.length - 1]
    groups.push({
      riders: riders.map((m, k) => {
        const solo = Math.round((meters[k] * 1.04) / 100) * 100
        return {
          member_id: m.id,
          nickname: m.nickname,
          arrival: shiftIso(leave.toISOString(), (22 + k * 11) * MIN),
          meter_at_dropoff: meters[k],
          share: shares[k],
          solo_fare: solo,
          saving: solo - shares[k],
        }
      }),
      total_fare: meters[meters.length - 1],
      estimated_meters: meters,
      payer_member_id: payer.id,
      payer: payer.nickname,
      source: 'estimate',
      estimated: true,
    })
  }
  return groups
}

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
  const adminToken = `adm_${randomId(24)}`
  const expiresAt = seoulIso(new Date(now.getTime() + 24 * 3600 * 1000))
  writeMockGroup({
    id,
    name: body.name ?? null,
    meeting_place: body.meeting_place,
    departure,
    expires_at: expiresAt,
    admin_token: adminToken,
    version: 1,
    members: [],
  })
  return {
    id,
    share_path: `/g/${id}`,
    admin_token: adminToken,
    departure,
    expires_at: expiresAt,
    name: body.name ?? null,
  }
}

/**
 * GET /api/groups/{id}[?leave_at] 예시 응답
 * - 이 브라우저에서 만든 모임: 기억해 둔 참여자로 마감·택시 묶음·정산을 흉내 냄 (금액은 임의)
 * - EXAMPLEgroupID16: server/examples/group_get.json 그대로
 */
export async function mockGetGroup(groupId, { token, leaveAt } = {}) {
  await wait(400)
  if (groupId === groupGet.id) return structuredClone(groupGet)
  const group = findMockGroup(groupId)
  const members = group.members.map((m, i) => ({
    id: m.id,
    nickname: m.nickname,
    area: m.area,
    is_me: Boolean(token) && m.token === token,
    ...(token && m.token === token ? { home: m.home } : {}),
    deadline: mockDeadline(group, i),
  }))
  // README: 마감이 빠른 순
  members.sort(
    (a, b) =>
      new Date(a.deadline.regular?.leave_by ?? 0) - new Date(b.deadline.regular?.leave_by ?? 0),
  )
  const result = {
    id: group.id,
    name: group.name,
    status: 'ready',
    version: group.version,
    is_admin: Boolean(token) && token === group.admin_token,
    departure: group.departure,
    expires_at: group.expires_at,
    meeting_place: group.meeting_place,
    members,
    notes: ['예시 데이터예요. 마감 시각과 택시 요금은 실제 계산이 아니에요'],
  }
  if (!leaveAt) return result
  const taxiGroups = mockTaxiGroups(members, leaveAt)
  return {
    ...result,
    leave_at: `${leaveAt}:00`,
    taxi_groups: taxiGroups,
    settlement: taxiGroups.flatMap((g) =>
      g.riders
        .filter((r) => r.member_id !== g.payer_member_id)
        .map((r) => ({ from: r.nickname, to: g.payer, amount: r.share, estimated: true })),
    ),
  }
}

/** POST /api/groups/{id}/members 예시 응답 */
export async function mockJoinGroup(groupId, body, adminToken) {
  await wait(400)
  // 서버 예시 모임은 바뀌지 않으므로 예시 속 '나'(is_me)로 들어간 것처럼
  if (groupId === groupGet.id) {
    const me = groupGet.members.find((m) => m.is_me) ?? groupGet.members[0]
    return { id: me.id, nickname: me.nickname, member_token: 'mem_example', area: me.area }
  }
  const group = findMockGroup(groupId)
  if (body.by_admin && adminToken !== group.admin_token) {
    throw new ApiError('모임을 만든 사람만 대신 넣을 수 있어요', { status: 403 })
  }
  // README: 닉네임이 겹치면 '민수2'처럼 번호를 붙여 돌려준다
  const taken = new Set(group.members.map((m) => m.nickname))
  let nickname = body.nickname
  for (let n = 2; taken.has(nickname); n += 1) nickname = `${body.nickname}${n}`
  const member = {
    id: `m_${randomId(8)}`,
    nickname,
    area: `${body.home.label} 근처`,
    home: body.home,
    token: `mem_${randomId(24)}`,
  }
  writeMockGroup({ ...group, version: group.version + 1, members: [...group.members, member] })
  return { id: member.id, nickname, member_token: member.token, area: member.area }
}

/** 토큰이 그 참여자 본인 것이거나 관리 토큰인지 */
function canEdit(group, member, token) {
  return token && (token === member.token || token === group.admin_token)
}

/** PATCH /api/groups/{id}/members/{member_id} */
export async function mockUpdateMember(groupId, memberId, body, token) {
  await wait(400)
  if (groupId === groupGet.id) return { id: memberId } // 예시 모임은 그대로
  const group = findMockGroup(groupId)
  const member = group.members.find((m) => m.id === memberId)
  if (!member) throw new ApiError('참여자를 찾지 못했어요', { status: 404 })
  if (!canEdit(group, member, token)) throw new ApiError('고칠 권한이 없어요', { status: 403 })
  const next = {
    ...member,
    ...(body.nickname ? { nickname: body.nickname } : {}),
    ...(body.home ? { home: body.home, area: `${body.home.label} 근처` } : {}),
  }
  writeMockGroup({
    ...group,
    version: group.version + 1,
    members: group.members.map((m) => (m.id === memberId ? next : m)),
  })
  return { id: next.id, nickname: next.nickname, area: next.area }
}

/** DELETE /api/groups/{id}/members/{member_id} */
export async function mockRemoveMember(groupId, memberId, token) {
  await wait(400)
  if (groupId === groupGet.id) return { deleted: true } // 예시 모임은 그대로
  const group = findMockGroup(groupId)
  const member = group.members.find((m) => m.id === memberId)
  if (!member) throw new ApiError('참여자를 찾지 못했어요', { status: 404 })
  if (!canEdit(group, member, token)) throw new ApiError('뺄 권한이 없어요', { status: 403 })
  writeMockGroup({
    ...group,
    version: group.version + 1,
    members: group.members.filter((m) => m.id !== memberId),
  })
  return { deleted: true }
}

/** DELETE /api/groups/{id} (만든 사람만) */
export async function mockEndGroup(groupId, token) {
  await wait(400)
  const group = findMockGroup(groupId)
  if (token !== group.admin_token)
    throw new ApiError('모임을 만든 사람만 끝낼 수 있어요', { status: 403 })
  writeMockGroup({ ...group, ended: true, members: [] })
  return { deleted: true }
}

/**
 * POST /api/settle — 실제 금액으로 다시 나누기 (README 규칙)
 * 각자 actual_meter가 있으면 그대로, 총액만 있으면 예상 미터기 비율로 늘이거나 줄임
 */
export async function mockSettle(body) {
  await wait(300)
  const { riders, total_fare: total } = body
  const actual = riders.every((r) => r.actual_meter != null)
  const last = riders[riders.length - 1].estimated_meter
  const meters = actual
    ? riders.map((r) => r.actual_meter)
    : riders.map((r, i) =>
        last ? Math.round((r.estimated_meter / last) * total) : ((i + 1) / riders.length) * total,
      )
  meters[meters.length - 1] = total
  const shares = splitMeters(meters)
  const payer = riders[riders.length - 1].nickname
  return {
    total_fare: total,
    method: actual ? 'actual_meters' : 'estimated_ratio',
    payer,
    shares: riders.map((r, i) => ({
      nickname: r.nickname,
      member_id: r.member_id,
      share: shares[i],
    })),
    transfers: riders
      .slice(0, -1)
      .map((r, i) => ({ from: r.nickname, to: payer, amount: shares[i] })),
  }
}

/** POST /api/feedback — 실제 택시비 (예상 범위 안이었는지) */
export async function mockFeedback(body) {
  await wait(300)
  if (body.actual_fare == null) return { skipped: true }
  const [lo, hi] = body.fare_range ?? [0, Infinity]
  return { saved: true, within_range: body.actual_fare >= lo && body.actual_fare <= hi }
}

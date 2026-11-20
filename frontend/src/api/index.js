// 화면에서 부르는 API 함수 모음 (server/README.md 기준)
import { USE_MOCK, request } from './client.js'
import {
  mockCreateGroup,
  mockEndGroup,
  mockFeedback,
  mockGeocode,
  mockGetGroup,
  mockJoinGroup,
  mockRemoveMember,
  mockReverse,
  mockRoutes,
  mockSettle,
  mockUpdateMember,
} from './mock.js'
import { getDeviceId } from '../utils/storage.js'

export { ApiError, USE_MOCK } from './client.js'

/** GET /api/geocode — 검색어 → 후보 (kind, label, address, lat, lng, region, in_seoul). 서울 안이 먼저 */
export function geocode(q, { signal } = {}) {
  if (USE_MOCK) return mockGeocode(q)
  return request(`/api/geocode?q=${encodeURIComponent(q)}`, { signal, timeoutMs: 8000 })
}

/** GET /api/reverse — 좌표 → 표시 이름 ("노원구 상계동") */
export function reverse(lat, lng) {
  if (USE_MOCK) return mockReverse(lat, lng)
  return request(`/api/reverse?lat=${lat}&lng=${lng}`, { timeoutMs: 8000 })
}

/**
 * POST /api/routes — 택시 직행 / 대중교통만 / 조합
 * departure는 S1 값 그대로("now" 또는 "23:40"). 실제 시각은 서버가 정해 응답 departure로 준다.
 * 요일 유형별 첫 요청은 40초쯤 걸릴 수 있어 넉넉히 기다린다.
 */
export function routes({ origin, destination, departure }, { signal } = {}) {
  const body = {
    origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
    destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
    departure_time: departure ?? 'now',
  }
  if (USE_MOCK) return mockRoutes(body)
  return request('/api/routes', { method: 'POST', body, signal, timeoutMs: 60000 })
}

/** POST /api/events — 사용 기록 (주소 금지, 동 이름까지만). 실패해도 화면에는 영향 없음 */
export function sendEvent(name, { optionKind, area } = {}) {
  if (USE_MOCK) return Promise.resolve({ saved: false })
  return request('/api/events', {
    method: 'POST',
    body: { device_id: getDeviceId(), name, option_kind: optionKind ?? null, area: area ?? null },
    timeoutMs: 5000,
  }).catch(() => ({ saved: false }))
}

const toPoint = (p) => ({ lat: p.lat, lng: p.lng, label: p.label })

/**
 * POST /api/groups — 모임 만들기
 * @returns {{id, share_path, admin_token, departure, expires_at}}
 *   admin_token은 만든 사람 브라우저에만 저장 (다시 받을 수 없음)
 */
export function createGroup({ name, meetingPlace, departure }) {
  const body = {
    name: name || undefined,
    meeting_place: toPoint(meetingPlace),
    departure_time: departure ?? 'now',
  }
  if (USE_MOCK) return mockCreateGroup(body)
  return request('/api/groups', { method: 'POST', body, timeoutMs: 15000 })
}

/**
 * GET /api/groups/{id}[?leave_at] — 모임 상태
 * - 참여자(마감이 빠른 순): nickname, area, is_me, deadline. 다른 사람의 집 주소는 오지 않고,
 *   본인 토큰으로 부를 때만 자기 home이 온다
 * - leaveAt('2026-12-19T01:00', 모임 끝나는 시각)을 주면 taxi_groups(택시 묶음)·settlement(예상 정산)까지
 * 무거운 요청(분당 20번)이라 S6 갱신은 10초 간격으로만 부른다.
 */
export function getGroup(groupId, { token, leaveAt, signal } = {}) {
  if (USE_MOCK) return mockGetGroup(groupId, { token, leaveAt })
  const query = leaveAt ? `?leave_at=${encodeURIComponent(leaveAt)}` : ''
  return request(`/api/groups/${encodeURIComponent(groupId)}${query}`, {
    token,
    signal,
    timeoutMs: 20000,
  })
}

/**
 * POST /api/groups/{id}/members — 모임 참여 (닉네임, 집 좌표)
 * 닉네임이 겹치면 서버가 '민수2'처럼 번호를 붙여 돌려준다.
 * 만든 사람이 다른 사람을 대신 넣을 때만 adminToken을 보낸다 (by_admin: true)
 * @returns {{id, nickname, member_token, area}}
 */
export function joinGroup(groupId, { nickname, home }, { adminToken } = {}) {
  const body = { nickname, home: toPoint(home), ...(adminToken ? { by_admin: true } : {}) }
  if (USE_MOCK) return mockJoinGroup(groupId, body, adminToken)
  return request(`/api/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    body,
    token: adminToken,
    timeoutMs: 15000,
  })
}

const memberPath = (groupId, memberId) =>
  `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`

/**
 * PATCH /api/groups/{id}/members/{member_id} — 닉네임·집 주소 고치기
 * token: 본인 참여자 토큰 또는 관리 토큰
 */
export function updateMember(groupId, memberId, { nickname, home }, token) {
  const body = {
    ...(nickname ? { nickname } : {}),
    ...(home ? { home: toPoint(home) } : {}),
  }
  if (USE_MOCK) return mockUpdateMember(groupId, memberId, body, token)
  return request(memberPath(groupId, memberId), { method: 'PATCH', body, token, timeoutMs: 15000 })
}

/** DELETE /api/groups/{id}/members/{member_id} — 빠지기(본인) / 참여자 삭제(만든 사람). 주소도 바로 지운다 */
export function removeMember(groupId, memberId, token) {
  if (USE_MOCK) return mockRemoveMember(groupId, memberId, token)
  return request(memberPath(groupId, memberId), { method: 'DELETE', token, timeoutMs: 15000 })
}

/** DELETE /api/groups/{id} — 모임 끝내기 (만든 사람만). 참여자 주소를 바로 지운다 */
export function endGroup(groupId, adminToken) {
  if (USE_MOCK) return mockEndGroup(groupId, adminToken)
  return request(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
    token: adminToken,
    timeoutMs: 15000,
  })
}

/**
 * POST /api/settle — 택시에서 내린 뒤 실제 금액으로 다시 나누기 (서버에 저장되지 않음)
 * @param {{nickname, member_id?, estimated_meter?, actual_meter?}[]} riders 내린 순서. 마지막 사람이 낸 사람
 * @returns {{total_fare, method, payer, shares[], transfers[]}}
 */
export function settle({ riders, totalFare }) {
  const body = { riders, total_fare: totalFare }
  if (USE_MOCK) return mockSettle(body)
  return request('/api/settle', { method: 'POST', body, timeoutMs: 15000 })
}

/**
 * POST /api/feedback — 도착 후 실제 요금 (F2-09). actualFare가 null이면 건너뛰기
 * 주소는 보내지 않는다 (서버는 거리대·시간대만 남김)
 * @returns {{saved?: boolean, within_range?: boolean, skipped?: boolean}}
 */
export function sendFeedback({
  optionId,
  optionKind,
  fareRange,
  actualFare,
  distanceM,
  departure,
}) {
  const body = {
    option_id: optionId,
    option_kind: optionKind,
    fare_range: fareRange,
    actual_fare: actualFare,
    distance_m: distanceM ?? null,
    departure: departure ? departure.slice(0, 16) : null,
    ...(actualFare == null ? { skipped: true } : {}),
  }
  if (USE_MOCK) return mockFeedback(body)
  return request('/api/feedback', { method: 'POST', body, timeoutMs: 8000 })
}

// 화면에서 부르는 API 함수 모음 (server/README.md 기준)
import { USE_MOCK, request } from './client.js'
import { mockGeocode, mockReverse, mockRoutes } from './mock.js'
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

// 명세: 출발 시각은 21:00 ~ 02:00, 10분 단위
export function buildDepartureOptions() {
  const options = []
  // 21:00(1260분)부터 다음날 02:00(1560분)까지
  for (let m = 21 * 60; m <= 26 * 60; m += 10) {
    const h = Math.floor(m / 60) % 24
    const mm = m % 60
    const label = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    options.push(label)
  }
  return options
}

export const DEPARTURE_OPTIONS = buildDepartureOptions()

/** 지금 시각에서 가장 가까운 다음 선택지 (범위 밖이면 23:40) */
export function defaultDepartureTime(now = new Date()) {
  let m = now.getHours() * 60 + now.getMinutes()
  if (m < 3 * 60) m += 24 * 60 // 새벽은 전날 밤 기준으로
  const rounded = Math.ceil(m / 10) * 10
  if (rounded < 21 * 60 || rounded > 26 * 60) return '23:40'
  const h = Math.floor(rounded / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

// ── S2용 시각 계산 ──
// 밤~새벽을 한 줄로 계산하려고 새벽(03시 전)은 24시를 더한 '분'으로 다룬다. 예: 00:32 → 1472

/** 'HH:MM' → 분 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m
  return h < 3 ? total + 24 * 60 : total
}

/** 분 → 'HH:MM' */
export function fromMinutes(total) {
  const h = Math.floor(total / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 검색 조건의 출발 시각('now' 또는 'HH:MM')을 분으로 */
export function departureMinutes(departure, now = new Date()) {
  if (departure && departure !== 'now') return toMinutes(departure)
  return toMinutes(fromMinutes(now.getHours() * 60 + now.getMinutes()))
}

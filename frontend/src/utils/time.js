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

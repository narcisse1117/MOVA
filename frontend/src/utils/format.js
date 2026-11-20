// 명세 C-05: 요금은 범위로, 100원 단위 반올림

export function round100(won) {
  return Math.round(won / 100) * 100
}

export function formatWon(won) {
  return `${round100(won).toLocaleString('ko-KR')}원`
}

/**
 * 14000, 16000 → '14,000 ~ 16,000원' (예상 요금이라 100원 단위 반올림)
 * 1550, 1550   → '1,550원' (정해진 요금이라 그대로)
 */
export function formatFareRange(min, max) {
  if (min === max) return `${min.toLocaleString('ko-KR')}원`
  const lo = round100(min)
  const hi = round100(max)
  return `${lo.toLocaleString('ko-KR')} ~ ${hi.toLocaleString('ko-KR')}원`
}

/** '2026-11-20T23:00:00+09:00' → '11월 20일 23:00' (서버가 주는 서울 시각 문자열 그대로) */
export function formatDateTime(iso) {
  if (!iso) return ''
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${Number(m)}월 ${Number(d)}일 ${iso.slice(11, 16)}`
}

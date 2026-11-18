// 결과 화면 공통 표시 함수

export const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`

export function fareText(range) {
  const [lo, hi] = range
  return lo === hi ? won(lo) : `${lo.toLocaleString('ko-KR')}~${won(hi)}`
}

/** ISO 시각 → '00:26' */
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '')

export function minutes(sec) {
  return Math.max(1, Math.round(sec / 60))
}

export const KIND_LABEL = { taxi: '택시 직행', transit: '대중교통만', combo: '택시 + 대중교통' }

/** 카드에 쓰는 탈것 요약: '2호선 → N62 → 택시' */
export function legSummary(legs) {
  return legs
    .filter((l) => l.type !== 'walk')
    .map((l) => (l.type === 'taxi' ? '택시' : l.line))
    .join(' → ')
}

export function savingText(o) {
  if (o.kind === 'taxi') return null
  if (o.saving_vs_taxi > 0) return `택시보다 ${won(o.saving_vs_taxi)} 아껴요`
  return null
}

export function delayText(o) {
  if (o.kind === 'taxi') return null
  const d = o.delay_vs_taxi_min
  if (d > 0) return `${d}분 늦게 도착`
  if (d < 0) return `${-d}분 빨리 도착`
  return '택시와 같이 도착'
}

/** F2-08: 추천 → 택시 직행 → 나머지(대중교통만, 다른 조합) → 갈 수 없음 */
export function sortCards(options) {
  const rank = (o) => (o.recommended ? 0 : !o.available ? 4 : o.kind === 'taxi' ? 1 : o.kind === 'combo' ? 2 : 3)
  return [...options].sort((a, b) => rank(a) - rank(b))
}

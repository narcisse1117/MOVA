// 이동 수단 정보 — 구간 막대(LegBar)와 타임라인(Timeline)이 같이 쓰는 한 곳
// 색은 tokens.css의 --mode-<키> 값. 새 수단은 여기와 tokens.css에 한 줄씩 추가하면
// 경로 데이터에 그 수단이 들어왔을 때 막대·타임라인 색이 자동으로 따라간다.

export const MODES = {
  taxi: { label: '택시', ride: true, lightText: true },
  bus: { label: '버스', ride: true, lightText: true },
  nightbus: { label: '심야버스', ride: true, lightText: true },
  subway: { label: '지하철', ride: true, lightText: true }, // 아래 표에 없는 노선
  line1: { label: '1호선', ride: true, lightText: true },
  line2: { label: '2호선', ride: true },
  line3: { label: '3호선', ride: true, lightText: true },
  line4: { label: '4호선', ride: true },
  line5: { label: '5호선', ride: true, lightText: true },
  line6: { label: '6호선', ride: true, lightText: true },
  line7: { label: '7호선', ride: true, lightText: true },
  line8: { label: '8호선', ride: true, lightText: true },
  line9: { label: '9호선', ride: true },
  shinbundang: { label: '신분당선', ride: true, lightText: true },
  suinbundang: { label: '수인분당선', ride: true },
  gyeongui: { label: '경의중앙선', ride: true },
  airport: { label: '공항철도', ride: true, lightText: true },
  gyeongchun: { label: '경춘선', ride: true, lightText: true },
  uisinseol: { label: '우이신설선', ride: true },
  sillim: { label: '신림선', ride: true, lightText: true },
  walk: { label: '도보', ride: false },
  none: { label: '연결 없음', ride: false },
}

// 서버가 주는 지하철 노선 이름(line) → 위 키
const SUBWAY_LINES = {
  신분당선: 'shinbundang',
  수인분당선: 'suinbundang',
  분당선: 'suinbundang',
  경의중앙선: 'gyeongui',
  공항철도: 'airport',
  경춘선: 'gyeongchun',
  우이신설선: 'uisinseol',
  신림선: 'sillim',
}

/**
 * 서버 구간(server/README.md의 legs) → 수단 키
 * type: walk | subway | bus | taxi, 버스는 night(심야버스)
 */
export function legMode(leg) {
  if (leg.type === 'taxi' || leg.type === 'walk') return leg.type
  if (leg.type === 'bus') return leg.night ? 'nightbus' : 'bus'
  const line = String(leg.line ?? '')
  const numbered = line.match(/^(\d)호선/)
  if (numbered) return `line${numbered[1]}`
  return SUBWAY_LINES[line] ?? 'subway'
}

/** 구간 막대·타임라인에 쓰는 짧은 이름: "2호선", "271번", "N13번", "택시", "도보" */
export function legLabel(leg) {
  if (leg.type === 'bus') return `${leg.line}번`
  if (leg.type === 'subway') return leg.line
  return modeLabel(leg.type)
}

export function modeLabel(mode) {
  return MODES[mode]?.label ?? mode
}

/** 타고 가는 수단인지 (도보·연결 없음은 false) */
export function isRide(mode) {
  return Boolean(MODES[mode]?.ride)
}

/** 흰 글씨를 써야 하는 진한 색 수단인지 */
export function hasLightText(mode) {
  return Boolean(MODES[mode]?.lightText)
}

/** CSS 색 값 — 정의되지 않은 수단이면 fallback */
export function modeColor(mode, fallback = 'var(--border-strong)') {
  return `var(--mode-${mode}, ${fallback})`
}

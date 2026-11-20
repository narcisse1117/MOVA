// 길안내: 현재 시각으로 '지금 어디쯤인지'를 구한다 (서버가 위치·실시간 갱신을 주지 않아 시각 기준)
import { legLabel } from '../data/modes.js'
import { formatFareRange } from './format.js'
import { hhmmOf, seoulLocal } from './time.js'

const MIN = 60 * 1000

/** ms → 서울 시각 'HH:MM' */
export const clockOf = (ms) => seoulLocal(ms).slice(11, 16)

/** 남은 시간 문구: '6분 남음' / '1시간 5분 남음' / '곧 출발' */
export function remainText(ms, soon = '곧 출발') {
  const m = Math.ceil(ms / MIN)
  if (m <= 0) return soon
  if (m < 60) return `${m}분 남음`
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''} 남음`
}

/** 택시는 서버 departure가 '잡은 뒤 출발'이라 잡기 시작하는 시각을 기준으로 */
const boardMs = (leg) =>
  new Date(leg.departure).getTime() - (leg.type === 'taxi' ? (leg.wait_sec ?? 0) * 1000 : 0)

/** 마지막 탈것 도착 + 이어서 걷는 시간 = 실제 도착 */
export function arrivalMsOf(legs) {
  const rides = legs.filter((l) => l.type !== 'walk')
  const lastIndex = legs.lastIndexOf(rides.at(-1))
  const trailing = legs.slice(lastIndex + 1).reduce((s, l) => s + (l.duration_sec ?? 0) * 1000, 0)
  return new Date(rides.at(-1).arrival).getTime() + trailing
}

/**
 * 혼자 가는 경로(경로 검색 option, 또는 모임 마감 경로)의 지금 상태
 * @param option api/adapt.js adaptOption 결과 (rawLegs, tight)
 * @param {{origin: string, destination: string}} names '출발지'·'도착지'를 바꿀 이름
 * @returns {{
 *   arrived: boolean, arrivalMs: number,
 *   top: {badges, big, meta},             // 상단 요약 카드
 *   missed: string|null,                   // 다음 탈 차를 놓쳤을 때 (서버 TIGHT_TRANSFER가 있을 때만)
 *   mark: {leg?: number, beforeLeg?: number, last?: boolean, text: string} // 타임라인 '지금' 자리
 * }}
 */
export function routeState(option, names, now) {
  const legs = option.rawLegs
  const name = (n) => (n === '출발지' ? names.origin : n === '도착지' ? names.destination : n)
  const rides = legs.map((l, i) => (l.type === 'walk' ? -1 : i)).filter((i) => i >= 0)
  const arrivalMs = arrivalMsOf(legs)
  if (now >= arrivalMs) return { arrived: true, arrivalMs }

  const nextIndex = rides.findIndex((r) => now < boardMs(legs[r]))

  // 더 탈 차가 없으면 도착까지
  if (nextIndex < 0) {
    const last = legs[rides.at(-1)]
    const riding = now < new Date(last.arrival).getTime()
    return {
      arrived: false,
      arrivalMs,
      top: {
        badges: [{ text: '도착까지', tone: 'primary' }],
        big: remainText(arrivalMs - now, '곧 도착'),
        meta: `${clockOf(arrivalMs)} ${names.destination} 도착`,
      },
      missed: null,
      mark: riding
        ? {
            leg: rides.at(-1),
            text: `타는 중 · ${hhmmOf(last.arrival)} ${name(last.to)}에서 내려요`,
          }
        : { last: true, text: '걸어가는 중' },
    }
  }

  const r = rides[nextIndex]
  const next = legs[r]
  const prevRide = nextIndex > 0 ? legs[rides[nextIndex - 1]] : null
  const riding = prevRide && now < new Date(prevRide.arrival).getTime()
  const kind = next.is_last
    ? '막차'
    : next.type === 'bus' && next.night
      ? '심야버스'
      : next.type === 'taxi'
        ? '택시'
        : null
  const tight = option.tight.find((w) => w.at === next.from && w.fallback)

  let mark
  if (riding) {
    mark = {
      leg: rides[nextIndex - 1],
      text: `타는 중 · ${hhmmOf(prevRide.arrival)} ${name(prevRide.to)}에서 내려요`,
    }
  } else if (nextIndex === 0) {
    mark = { beforeLeg: r, leg: r, text: `${name(next.from)}까지 가는 중` }
  } else {
    mark = { beforeLeg: r, leg: r, text: '갈아타는 중' }
  }

  return {
    arrived: false,
    arrivalMs,
    top: {
      badges: [{ text: '다음 탈 차', tone: 'primary' }, ...(kind ? [{ text: kind }] : [])],
      big: remainText(boardMs(next) - now),
      meta:
        next.type === 'taxi'
          ? `택시 · ${clockOf(boardMs(next))} ${name(next.from)} 앞에서 잡기`
          : `${legLabel(next)} · ${hhmmOf(next.departure)} ${name(next.from)} 출발`,
    },
    missed: tight
      ? `${next.type === 'taxi' ? '택시' : legLabel(next)}을 놓치면 ${name(tight.fallback.from)}에서 택시 · 약 ${formatFareRange(tight.fallback.fareMin, tight.fallback.fareMax)}`
      : null,
    missedAt: tight ? r : null,
    mark,
  }
}

/** 타임라인 단계에 '지금' 표시를 붙이고, 위로 올린 '놓쳤을 때'는 단계에서 뺌 */
export function markSteps(steps, state) {
  const { mark, missedAt } = state
  let target = -1
  if (mark?.last) target = steps.length - 1
  else if (mark?.beforeLeg != null) target = steps.findIndex((s) => s.beforeLeg === mark.beforeLeg)
  if (target < 0 && mark?.leg != null) target = steps.findIndex((s) => s.leg === mark.leg)
  return steps.map((s, i) => ({
    ...s,
    now: i === target ? mark.text : undefined,
    missed: missedAt != null && s.leg === missedAt ? undefined : s.missed,
  }))
}

/**
 * 모임 택시 합승의 지금 상태
 * @param guide { leaveAt, group(taxi_groups 한 대 + area), myId, meeting, homeLabel }
 */
export function taxiState(guide, now) {
  const { group, myId, meeting, homeLabel } = guide
  const leaveMs = new Date(`${guide.leaveAt}:00+09:00`).getTime()
  const n = group.riders.length
  const k = group.riders.findIndex((r) => r.member_id === myId)
  const me = group.riders[k]
  const arrivalMs = new Date(me.arrival).getTime()
  const badges = [
    { text: n > 1 ? `택시 합승 ${n}명` : '택시', tone: 'primary' },
    ...(group.estimated ? [{ text: '요금 추정', tone: 'muted' }] : []),
  ]
  if (now >= arrivalMs) return { arrived: true, arrivalMs }

  if (now < leaveMs) {
    return {
      arrived: false,
      arrivalMs,
      top: {
        badges: [
          { text: '다음 탈 차', tone: 'primary' },
          ...badges.slice(0, 1).map((b) => ({ text: b.text })),
        ],
        big: remainText(leaveMs - now),
        meta: `택시 · ${guide.leaveAt.slice(11, 16)} ${meeting.label} 앞에서 ${n > 1 ? '합승' : '승차'}`,
      },
      mark: { text: '곧 타요' },
    }
  }

  // 타는 중: 다음에 내리는 사람(나 포함)까지
  const nextRider = group.riders.slice(0, k + 1).find((r) => new Date(r.arrival).getTime() > now)
  const isMe = nextRider.member_id === myId
  const station = (area) => (String(area ?? '').split(' · ')[1] ?? area ?? '').replace(/ 근처$/, '')
  return {
    arrived: false,
    arrivalMs,
    top: {
      badges: [{ text: '타는 중' }, ...badges],
      big: remainText(new Date(nextRider.arrival).getTime() - now, '곧 도착'),
      meta: isMe
        ? `다음은 내 하차예요 · ${hhmmOf(me.arrival)} ${homeLabel}`
        : `다음은 ${nextRider.nickname} 하차예요 · ${hhmmOf(nextRider.arrival)} ${station(nextRider.area)}`,
    },
    mark: { text: '택시 타고 가는 중' },
  }
}

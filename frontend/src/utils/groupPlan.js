// S6 묶음 카드 만들기 (와이어프레임 S6) — 서버 GET /api/groups/{id}?leave_at 결과로
// - 택시 묶음(taxi_groups) 한 대 = 카드 하나
// - 택시에 안 묶인 사람은 각자 카드 하나 (서버가 대중교통 사람끼리 묶어 주지는 않음)
// - 출발 마감이 빠른 순 (와이어프레임 '묶음 · 출발 마감 빠른 순', F3-13)
import { legMinutes } from '../api/adapt.js'
import { legLabel, legMode } from '../data/modes.js'
import { round100 } from './format.js'
import { hhmmOf, seoulMs } from './time.js'

/** 정해진 금액(대중교통 요금, 10원 단위 정산 몫)은 반올림하지 않음 */
export const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`

/** area '노원구 상계동 · 노원역 근처' → '노원' (경로 줄에 쓰는 짧은 이름) */
function stopOf(area) {
  const station = String(area ?? '').split(' · ')[1]
  return (station ?? String(area ?? '')).replace(/ 근처$/, '').replace(/역$/, '')
}

/** 타는 수단으로 카드 제목: 지하철 / 버스 / 심야버스 / 대중교통 */
function transitTitle(legs) {
  const rides = legs.filter((l) => l.type === 'subway' || l.type === 'bus')
  if (rides.some((l) => l.type === 'bus' && l.night)) return '심야버스'
  if (rides.length && rides.every((l) => l.type === 'subway')) return '지하철'
  if (rides.length && rides.every((l) => l.type === 'bus')) return '버스'
  return '대중교통'
}

/** '2호선 → 7호선 막차 23:58' */
function transitRoute(legs) {
  const rides = legs.filter((l) => l.type === 'subway' || l.type === 'bus')
  const last = rides.find((l) => l.is_last)
  const line = rides.map(legLabel).join(' → ')
  return last ? `${line} 막차 ${hhmmOf(last.departure)}` : line
}

function taxiBundle(group, index, meetingLabel, leaveAt, myId) {
  const n = group.riders.length
  const last = group.riders[n - 1]
  const minutes = Math.max(1, Math.round((new Date(last.arrival) - seoulMs(leaveAt)) / 60000))
  return {
    key: `taxi-${group.riders.map((r) => r.member_id).join('-') || index}`,
    kind: 'taxi',
    deadlineMs: seoulMs(leaveAt),
    deadline: `${leaveAt.slice(11, 16)} 출발`,
    mine: group.riders.some((r) => r.member_id === myId),
    title: n > 1 ? `택시 합승 · ${n}명` : '택시 · 1명',
    names: group.riders.map((r) => r.nickname).join(' · '),
    route: [meetingLabel, ...group.riders.map((r) => `${stopOf(r.area)}(${r.nickname})`)].join(
      ' → ',
    ),
    legs: [{ mode: 'taxi', label: n > 1 ? '택시 합승' : '택시', minutes }],
    price:
      n > 1
        ? `1인 약 ${won(round100(group.total_fare / n))} (총 ${won(group.total_fare)})`
        : `약 ${won(group.total_fare)}`,
    estimated: group.estimated,
  }
}

function soloBundle(member, leaveAt, myId) {
  const leave = seoulMs(leaveAt)
  const { regular, night } = member.deadline ?? {}
  const usable = [regular, night].find((d) => d && leave <= new Date(d.latest).getTime())
  const base = {
    key: `member-${member.id}`,
    kind: 'solo',
    mine: member.id === myId,
    names: member.nickname,
  }
  if (!usable) {
    return {
      ...base,
      deadlineMs: leave,
      deadline: '막차 끊김',
      title: '택시 · 1명',
      route: '지하철·버스와 심야버스가 모두 끊겨요',
      legs: [],
      price: '',
    }
  }
  const legs = usable.route?.legs ?? []
  return {
    ...base,
    deadlineMs: new Date(usable.leave_by).getTime(),
    deadline: `${hhmmOf(usable.leave_by)} 출발 마감`,
    title: `${transitTitle(legs)} · 1명`,
    route: transitRoute(legs),
    legs: legs
      .filter((l) => l.type !== 'walk' || legs.length === 1)
      .map((l) => ({ mode: legMode(l), label: legLabel(l), minutes: legMinutes(l) })),
    price: usable.route?.fare != null ? `1인 ${won(usable.route.fare)}` : '',
    warning: usable === regular ? regular.extra_if_late?.message : null,
  }
}

/**
 * @param group 서버 응답 (members, taxi_groups, meeting_place)
 * @param {string} leaveAt 'YYYY-MM-DDTHH:MM' (모임 출발 시각)
 * @returns 출발 마감 빠른 순 카드 목록
 */
export function buildBundles(group, leaveAt) {
  const myId = group.members.find((m) => m.is_me)?.id
  const areaOf = Object.fromEntries(group.members.map((m) => [m.id, m.area]))
  const taxiGroups = (group.taxi_groups ?? []).map((g) => ({
    ...g,
    riders: g.riders.map((r) => ({ ...r, area: areaOf[r.member_id] })),
  }))
  const inTaxi = new Set(taxiGroups.flatMap((g) => g.riders.map((r) => r.member_id)))
  return [
    ...taxiGroups.map((g, i) => taxiBundle(g, i, group.meeting_place?.label, leaveAt, myId)),
    ...group.members.filter((m) => !inTaxi.has(m.id)).map((m) => soloBundle(m, leaveAt, myId)),
  ].sort((a, b) => a.deadlineMs - b.deadlineMs)
}

/**
 * 누가 누구에게 얼마 — 서버 settlement(예상)가 있으면 그대로, 없으면 택시 묶음의 몫으로
 * @returns {{groupIndex, from, to, amount}[]}
 */
export function buildTransfers(group) {
  const taxiGroups = group.taxi_groups ?? []
  const fromServer = group.settlement ?? []
  return taxiGroups.flatMap((g, groupIndex) => {
    const riders = g.riders.filter((r) => r.member_id !== g.payer_member_id)
    return riders.map((r) => {
      const server = fromServer.find((t) => t.from === r.nickname && t.to === g.payer)
      return { groupIndex, from: r.nickname, to: g.payer, amount: server?.amount ?? r.share }
    })
  })
}

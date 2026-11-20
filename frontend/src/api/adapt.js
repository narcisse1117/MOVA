// 서버 응답(server/README.md, snake_case) → 화면에서 쓰는 모양
import { isRide, legLabel, legMode } from '../data/modes.js'
import { formatFareRange } from '../utils/format.js'

/** '2026-11-19T00:30:00+09:00' → '00:30' */
export function hhmm(iso) {
  return typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : ''
}

/** 서울 시각 'HH:MM' (Date → 문자열, 서버 응답과 같은 +09:00 기준) */
function toSeoulHHMM(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function minutesBetween(fromIso, toIso) {
  return Math.max(1, Math.round((new Date(toIso) - new Date(fromIso)) / 60000))
}

/** 구간 하나의 분 (도보는 duration_sec, 타는 구간은 출발~도착) — S6 묶음 카드도 사용 */
export function legMinutes(leg) {
  if (leg.type === 'walk') return Math.max(1, Math.round(leg.duration_sec / 60))
  return minutesBetween(leg.departure, leg.arrival)
}

/** 지하철 trip "4600 불암산행" → "불암산" (행선지). 없으면 null */
function headsign(leg) {
  const m = String(leg.trip ?? '').match(/(\S+)행$/)
  return m ? m[1] : null
}

const KIND_LABEL = { combo: '조합', taxi: '택시 직행', transit: '대중교통만' }
const KIND_ORDER = { combo: 0, taxi: 1, transit: 2 } // 명세 F2-08: 추천 조합 → 택시 직행 → 대중교통만

/** 카드 제목: 타는 수단을 순서대로 "버스 + 심야버스 + 택시" */
function titleOf(legs) {
  const names = []
  for (const leg of legs) {
    if (leg.type === 'walk') continue
    const name =
      leg.type === 'taxi'
        ? '택시'
        : leg.type === 'subway'
          ? '지하철'
          : leg.night
            ? '심야버스'
            : '버스'
    if (names.at(-1) !== name) names.push(name)
  }
  return names.join(' + ') || '대중교통'
}

function badgesOf(o) {
  const kind = KIND_LABEL[o.kind] ?? o.kind
  const badges = []
  if (o.recommended && o.kind === 'combo') badges.push({ text: '추천 조합', tone: 'primary' })
  else if (o.recommended) badges.push({ text: '추천', tone: 'primary' }, { text: kind })
  else badges.push({ text: kind })
  if (o.available === false) badges.push({ text: '막차 끊김', tone: 'muted' })
  if ((o.legs ?? []).some((l) => l.type === 'bus' && l.night)) badges.push({ text: '심야버스' })
  return badges
}

function adaptOption(o, fallbackId) {
  const legs = o.legs ?? []
  const fareRange = o.fare_range ?? (o.fare != null ? [o.fare, o.fare] : [0, 0])
  const warnings = o.warnings ?? []
  const firstRide = legs.find((l) => l.type === 'subway' || l.type === 'bus')

  return {
    id: o.option_id ?? fallbackId,
    kind: o.kind,
    comboKind: o.combo_kind ?? null,
    recommended: Boolean(o.recommended),
    available: o.available !== false,
    message: o.message ?? null, // 갈 수 없는 카드의 안내 ("대중교통 막차가 00:29에 끊겼어요")
    badges: badgesOf(o),
    title: titleOf(legs),
    fareMin: fareRange[0],
    fareMax: fareRange[1],
    durationMin: o.duration_min ?? null,
    arrival: hhmm(o.arrival),
    savingVsTaxi: o.saving_vs_taxi ?? null,
    transitFare: o.fare_detail?.transit ?? 0, // 실제 택시비에 더해 실제 총액을 만들 때 (S7)
    delayVsTaxiMin: o.delay_vs_taxi_min ?? null,
    bar: legs.map((l) => ({ mode: legMode(l), label: legLabel(l), minutes: legMinutes(l) })),
    tight: warnings
      .filter((w) => w.code === 'TIGHT_TRANSFER')
      .map((w) => ({
        at: w.at,
        slackSec: w.slack_sec,
        message: w.message,
        fallback: w.fallback_taxi
          ? {
              from: w.fallback_taxi.from,
              fareMin: w.fallback_taxi.fare_range?.[0] ?? w.fallback_taxi.fare,
              fareMax: w.fallback_taxi.fare_range?.[1] ?? w.fallback_taxi.fare,
            }
          : null,
      })),
    notices: warnings
      .filter((w) => w.code !== 'TIGHT_TRANSFER')
      .map((w) => ({ code: w.code, message: w.message })),
    realtime: firstRide?.realtime ? { label: legLabel(firstRide), ...firstRide.realtime } : null,
    taxiDistanceM: legs
      .filter((l) => l.type === 'taxi')
      .reduce((sum, l) => sum + (l.distance_m ?? 0), 0),
    rawLegs: legs,
  }
}

/**
 * POST /api/routes 응답 → 화면용
 * - 카드 정렬: 탈 수 있는 안 먼저, 그 안에서 조합 → 택시 직행 → 대중교통만 (서버 순서 유지)
 * - 강조(추천)는 정렬과 상관없이 서버의 recommended 값으로
 */
export function adaptRoutes(res) {
  const perKind = {}
  const options = (res.options ?? [])
    // option_id가 없는 옛 응답 예시 대비: kind-번호
    .map((o) => adaptOption(o, `${o.kind}-${(perKind[o.kind] = (perKind[o.kind] ?? 0) + 1)}`))
    .map((o, i) => ({ o, i }))
    .sort(
      (a, b) =>
        Number(!a.o.available) - Number(!b.o.available) ||
        (KIND_ORDER[a.o.kind] ?? 9) - (KIND_ORDER[b.o.kind] ?? 9) ||
        a.i - b.i,
    )
    .map(({ o }) => o)

  return {
    departureIso: res.departure,
    departure: hhmm(res.departure),
    live: Boolean(res.live),
    options,
    lastService: res.last_service
      ? {
          regularCut: Boolean(res.last_service.regular_cut),
          regularLastDeparture: hhmm(res.last_service.regular_last_departure),
          allNight: Boolean(res.last_service.all_night),
        }
      : null,
    dataAsOf: res.data_as_of ?? null,
  }
}

/**
 * S3 타임라인 단계 만들기 — 실제 구간(legs)에서 자동으로
 * 단계: [출발(도보로 시작할 때)] → 탑승 → (하차 → 환승 → 탑승)… → 하차 → 도착
 * 각 단계: { time, title, mode?, desc?, note?, warning?, missed?, leg?, beforeLeg? }
 *   leg: 타는 단계의 구간 번호(legs 기준), beforeLeg: 그 구간을 타기 전 단계(출발·환승) — 길안내에서 '지금' 표시용
 * mode가 있는 단계(타는 구간)는 세로선이 그 수단 색으로 칠해진다.
 */
export function buildTimeline(option, search, departureIso) {
  const legs = option.rawLegs
  // 서버는 출발·도착 지점을 "출발지"·"도착지"로 준다 → 사용자가 고른 이름으로
  const name = (n) =>
    n === '출발지' ? search.origin.label : n === '도착지' ? search.destination.label : n
  const walkMin = (from, to) =>
    legs
      .slice(from, to)
      .filter((l) => l.type === 'walk')
      .reduce((s, l) => s + l.duration_sec, 0) / 60
  const rides = legs.map((l, i) => (l.type === 'walk' ? -1 : i)).filter((i) => i >= 0)
  const steps = []

  if (rides.length === 0) return steps

  // 걸어서 시작하면 출발 단계
  const leading = walkMin(0, rides[0])
  if (leading > 0) {
    steps.push({
      time: hhmm(departureIso),
      title: `${search.origin.label} 출발`,
      desc: `${name(legs[rides[0]].from)}까지 도보 ${Math.round(leading)}분`,
      beforeLeg: rides[0],
    })
  }

  rides.forEach((r, k) => {
    const leg = legs[r]
    const tight = option.tight.find((w) => w.at === leg.from)

    // 앞 탈것에서 내려 갈아타는 단계 (그 자리에서 바로 택시를 타면 택시 단계로 충분해서 생략)
    const prev = k > 0 ? legs[rides[k - 1]] : null
    const between = prev ? Math.round(walkMin(rides[k - 1] + 1, r)) : 0
    if (prev && !(leg.type === 'taxi' && between === 0 && !tight)) {
      const next = leg.type === 'taxi' ? '택시' : legLabel(leg)
      steps.push({
        time: hhmm(prev.arrival),
        title: `${name(prev.to)} 하차 → ${next} ${leg.type === 'taxi' ? '승차' : '환승'}`,
        desc:
          between > 0
            ? name(prev.to) === name(leg.from)
              ? `갈아타는 곳까지 도보 약 ${between}분`
              : `${name(leg.from)}까지 도보 약 ${between}분`
            : undefined,
        warning: tight ? `${tight.message} · 빠듯해요` : null,
        beforeLeg: r,
      })
    }

    // 타는 단계
    const minutes = legMinutes(leg)
    let title
    let desc
    if (leg.type === 'taxi') {
      const waitMin = Math.round((leg.wait_sec ?? 0) / 60)
      title = `${name(leg.from)} 앞 택시 승차`
      desc = `택시 ${minutes}분 · 약 ${formatFareRange(...(leg.fare_range ?? [leg.fare, leg.fare]))}${
        waitMin > 0 ? ` · 잡는 데 약 ${waitMin}분` : ''
      }`
    } else if (leg.type === 'subway') {
      const to = headsign(leg)
      title = `${leg.line}${to ? ` ${to} 방면` : ''} 탑승${leg.is_last ? ' (막차)' : ''}`
      desc = `${name(leg.from)} → ${name(leg.to)} · ${leg.stops}개 역 · ${minutes}분`
    } else {
      title = `${leg.night ? '심야버스 ' : ''}${leg.line}번 탑승${leg.is_last ? ' (막차)' : ''}`
      desc = `${name(leg.from)} 정류장 · ${leg.stops}개 정류장 · ${minutes}분${
        leg.headway_min ? ` · 배차 약 ${Math.round(leg.headway_min)}분` : ''
      }${leg.timetable === 'estimate' ? ' · 시각 추정' : ''}`
    }

    const mode = legMode(leg)
    // 서버의 택시 departure는 잡은 뒤 출발 시각 → 화면에는 잡기 시작하는 시각
    const startIso =
      leg.type === 'taxi' && leg.wait_sec
        ? new Date(new Date(leg.departure).getTime() - leg.wait_sec * 1000).toISOString()
        : null
    steps.push({
      time: startIso ? toSeoulHHMM(startIso) : hhmm(leg.departure),
      title,
      desc,
      mode: isRide(mode) ? mode : undefined,
      leg: r,
      // 실시간(live) 정보는 첫 탈것에만 붙어 온다
      note: leg.realtime?.message ? `실시간 · ${leg.realtime.message}` : undefined,
      // 명세 F1-13: 놓쳤을 때 그 자리에서 택시를 타는 대안
      missed: tight?.fallback
        ? {
            desc: `${name(tight.fallback.from)}에서 택시 · 약 ${formatFareRange(
              tight.fallback.fareMin,
              tight.fallback.fareMax,
            )}`,
          }
        : undefined,
    })
  })

  // 마지막 탈것에서 내린 뒤 걸어가면 하차 단계 (택시는 문 앞까지라 생략)
  const last = legs[rides.at(-1)]
  const trailing = Math.round(walkMin(rides.at(-1) + 1, legs.length))
  if (last.type !== 'taxi' && (trailing > 0 || name(last.to) !== search.destination.label)) {
    steps.push({
      time: hhmm(last.arrival),
      title: `${name(last.to)} 하차`,
      desc: trailing > 0 ? `도보 ${trailing}분` : undefined,
    })
  }

  steps.push({ time: option.arrival, title: `도착 · ${search.destination.label}` })
  return steps
}

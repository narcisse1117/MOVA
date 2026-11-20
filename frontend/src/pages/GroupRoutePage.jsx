import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { adaptRoutes, buildTimeline } from '../api/adapt.js'
import { sendEvent } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Icon from '../components/Icon.jsx'
import LegBar from '../components/LegBar.jsx'
import Timeline from '../components/Timeline.jsx'
import Toast from '../components/Toast.jsx'
import { useToast } from '../hooks/useToast.js'
import { formatFareRange } from '../utils/format.js'
import { won } from '../utils/groupPlan.js'
import { loadGroupRoute, saveChosenOption } from '../utils/storage.js'
import { hhmmOf } from '../utils/time.js'
import styles from './DetailPage.module.css'

/** area '노원구 상계동 · 노원역 근처' → '노원역' */
const stationOf = (area) =>
  (String(area ?? '').split(' · ')[1] ?? String(area ?? '')).replace(/ 근처$/, '')

/** 혼자 가는 사람: 서버 deadline.route(경로 검색 option과 같은 모양) → S3 타임라인 */
function soloView(payload) {
  const { detail, meeting, homeLabel } = payload
  const data = adaptRoutes({ departure: detail.leaveBy, options: [detail.route] })
  const option = data.options[0]
  const search = { origin: { label: meeting.label }, destination: { label: homeLabel } }
  return {
    badges: [{ text: `${hhmmOf(detail.leaveBy)} 출발 마감` }, ...option.badges],
    fare: formatFareRange(option.fareMin, option.fareMax),
    meta: { minutes: option.durationMin, from: hhmmOf(detail.leaveBy), to: option.arrival },
    bar: option.bar,
    notices: [detail.extra, ...option.notices.map((n) => n.message)].filter(Boolean),
    steps: buildTimeline(option, search, detail.leaveBy),
    chosen: {
      optionId: option.id,
      optionKind: option.kind,
      title: option.title,
      departure: detail.leaveBy,
      arrival: option.arrival,
      fareRange: [option.fareMin, option.fareMax],
      distanceM: option.taxiDistanceM,
      hasTaxi: option.taxiDistanceM > 0 || option.kind === 'taxi',
      transitFare: option.transitFare,
      savingVsTaxi: option.savingVsTaxi,
    },
  }
}

/**
 * 택시 합승: 서버 taxi_groups의 내 정보로 '모임 장소 승차 → 앞사람 하차 → 내 하차' 타임라인
 * 서버가 택시의 세부 길·내린 뒤 이어 타는 막차는 주지 않아서 하차 순서와 시각·금액만 보여줌
 */
function taxiView(payload) {
  const { detail, meeting, homeLabel, leaveAt, myId } = payload
  const g = detail.group
  const leaveIso = `${leaveAt}:00+09:00`
  const n = g.riders.length
  const k = g.riders.findIndex((r) => r.member_id === myId)
  const me = g.riders[k]
  const payer = g.riders.find((r) => r.member_id === g.payer_member_id) ?? g.riders[n - 1]
  const iPay = me.member_id === payer.member_id
  const minutes = Math.max(1, Math.round((new Date(me.arrival) - new Date(leaveIso)) / 60000))

  const steps = [
    {
      time: hhmmOf(leaveIso),
      title: `${meeting.label} 앞 택시 ${n > 1 ? '합승' : '승차'}`,
      desc:
        n > 1
          ? `${g.riders.map((r) => r.nickname).join(' → ')} 순서로 내려요 · 나는 ${k + 1}번째`
          : `택시 ${minutes}분`,
      mode: 'taxi',
    },
    ...g.riders.slice(0, k).map((r) => ({
      time: hhmmOf(r.arrival),
      title: `${r.nickname} 하차 · ${stationOf(r.area)}`,
      desc: `여기까지 미터기 약 ${won(r.meter_at_dropoff)}`,
      mode: 'taxi',
    })),
    {
      time: hhmmOf(me.arrival),
      title: `도착 · ${homeLabel}`,
      desc:
        n > 1
          ? iPay
            ? `마지막에 내려 택시비 ${won(g.total_fare)}을 내고, 나머지에게 받아요`
            : `내 몫 ${won(me.share)} · ${payer.nickname}님에게 보내요`
          : `택시비 약 ${won(me.share)}`,
    },
  ]

  return {
    badges: [
      { text: `${hhmmOf(leaveIso)} 출발` },
      { text: n > 1 ? `택시 합승 ${n}명` : '택시', tone: 'primary' },
      ...(g.estimated ? [{ text: '요금 추정', tone: 'muted' }] : []),
    ],
    fare: n > 1 ? `내 몫 ${won(me.share)}` : `약 ${won(me.share)}`,
    meta: { minutes, from: hhmmOf(leaveIso), to: hhmmOf(me.arrival) },
    bar: [{ mode: 'taxi', label: n > 1 ? '택시 합승' : '택시', minutes }],
    notices: [
      n > 1 && me.solo_fare > me.share ? `혼자 탔으면 약 ${won(me.solo_fare)}` : null,
      '같이 탄 구간은 나누고, 혼자 탄 구간은 혼자 내요',
      '택시 경로는 하차 순서와 시각만 보여요',
    ].filter(Boolean),
    steps,
    chosen: {
      optionId: 'group-taxi',
      optionKind: 'group_taxi',
      title: n > 1 ? `택시 합승 ${n}명` : '택시',
      departure: leaveIso,
      arrival: hhmmOf(me.arrival),
      fareRange: [me.share, me.share],
      hasTaxi: true,
      // S7: 내린 뒤 실제 총액으로 다시 나누기 (POST /api/settle)
      group:
        n > 1
          ? {
              groupId: payload.groupId,
              payer: payer.nickname,
              estimatedTotal: g.total_fare,
              riders: g.riders.map((r, i) => ({
                nickname: r.nickname,
                member_id: r.member_id,
                estimated_meter: g.estimated_meters?.[i] ?? r.meter_at_dropoff,
              })),
            }
          : null,
    },
  }
}

/**
 * 모임 '내 경로' /g/:groupId/route (명세 S6 '내 카드 누르기 → 내 경로 S3')
 * 다시 검색하지 않고, S6에서 받은 모임 응답(혼자: deadline.route / 합승: taxi_groups)으로 그린다
 * 주소는 URL에 넣지 않음 → 라우터 state, 새로고침이면 sessionStorage
 */
export default function GroupRoutePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { groupId } = useParams()
  const [payload] = useState(() => {
    const p = location.state ?? loadGroupRoute()
    return p?.groupId === groupId && p.detail ? p : null
  })
  const [toast, showToast] = useToast()

  if (!payload) return <Navigate to={`/g/${groupId}`} replace />

  const view = payload.detail.kind === 'taxi' ? taxiView(payload) : soloView(payload)
  const back = () => navigate(`/g/${groupId}`)

  function handleChoose() {
    saveChosenOption({
      ...view.chosen,
      origin: payload.meeting.label,
      destination: payload.homeLabel,
      groupId,
    })
    sendEvent('select_option', { optionKind: view.chosen.optionKind })
    showToast('이 경로를 저장했어요')
  }

  return (
    <div className={styles.page}>
      <AppBar leading="back" title="내 경로" tone="canvas" wide onBack={back} />

      <div className={`page-body ${styles.layout}`} data-layout="wide">
        <aside className={styles.side}>
          <section className={styles.summary} aria-label="경로 요약">
            <div className={styles.badges}>
              {view.badges.map((b) => (
                <Badge key={b.text} tone={b.tone}>
                  {b.text}
                </Badge>
              ))}
            </div>
            <p className={`${styles.fare} t-fare-l`}>{view.fare}</p>
            <p className={`${styles.meta} t-body-small`}>
              {view.meta.minutes}분 · {view.meta.from} 출발
              <Icon name="arrow-right" size={12} className={styles.metaArrow} />
              {view.meta.to} 도착
            </p>
            <LegBar legs={view.bar} />
            {view.notices.map((text) => (
              <p key={text} className={`${styles.notice} t-caption`}>
                {text}
              </p>
            ))}
          </section>

          <div className={styles.actions}>
            <Button onClick={handleChoose}>이렇게 갈게요</Button>
          </div>

          <p className={`${styles.notice} t-caption`}>
            {payload.groupName || '모임'} · 실제 운행은 운영사 안내를 확인하세요
          </p>
        </aside>

        <div className={styles.timeline}>
          <Timeline steps={view.steps} />
        </div>
      </div>

      <Toast message={toast} />
    </div>
  )
}

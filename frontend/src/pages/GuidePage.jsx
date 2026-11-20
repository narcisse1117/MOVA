import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { buildTimeline } from '../api/adapt.js'
import AppBar from '../components/AppBar.jsx'
import ArrivalQuestion from '../components/ArrivalQuestion.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import LegBar from '../components/LegBar.jsx'
import SettlementSection from '../components/SettlementSection.jsx'
import Timeline from '../components/Timeline.jsx'
import Toast from '../components/Toast.jsx'
import { useToast } from '../hooks/useToast.js'
import { copyText } from '../utils/clipboard.js'
import { clockOf, markSteps, routeState, taxiState } from '../utils/guide.js'
import { taxiView } from '../utils/routeViews.js'
import {
  clearGuide,
  loadChosenOption,
  loadGuide,
  markChosenAsked,
  updateGuide,
} from '../utils/storage.js'
import detail from './DetailPage.module.css'
import styles from './GuidePage.module.css'

const TICK_MS = 15000 // 남은 시간은 15초마다 다시 계산 (분 단위 표시)

/** 지금 시각 — 15초마다, 그리고 탭이 다시 보일 때 */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, TICK_MS)
    const onVisible = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return now
}

/** 이동 중 화면이 꺼지지 않게 (지원하는 브라우저만, 실패해도 무시) */
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined
    let lock = null
    let cancelled = false
    const request = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) l.release()
          else lock = l
        })
        .catch(() => {})
    request()
    const onVisible = () => !document.hidden && request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [active])
}

/** S3 요약 카드 모양 (배지 → 큰 글자 → 설명 → 구간 막대) */
function Summary({ badges, big, meta, bar }) {
  return (
    <section className={detail.summary} aria-label="지금 상황" aria-live="polite">
      <div className={detail.badges}>
        {badges.map((b) => (
          <Badge key={b.text} tone={b.tone}>
            {b.text}
          </Badge>
        ))}
      </div>
      <p className={`${detail.fare} t-fare-l`}>{big}</p>
      <p className={`${detail.meta} t-body-small`}>{meta}</p>
      {bar && <LegBar legs={bar} />}
    </section>
  )
}

/**
 * 길안내 /guide — '이렇게 갈게요' 다음 화면
 * - 현재 시각으로 지금 단계를 정해 타임라인에 '지금' 표시, 위 카드에는 다음 탈 차까지 남은 시간
 *   (마지막 탈것을 타면 도착까지, 모임 택시 합승은 다음 하차까지)
 * - 서버 TIGHT_TRANSFER가 있으면 다음 탈 차를 놓쳤을 때 택시 요금을 위 카드 아래에
 * - 도착 시각이 지나거나 '도착했어요'를 누르면 그 자리에서 실제 택시비를 묻는다 (S7을 화면 안에서)
 *
 * 서버가 주지 않아 못 하는 것: 위치 기반 안내(역·정류장 좌표 없음), 이동 중 실시간 도착 갱신,
 * 남은 정류장 수(중간 정류장 시각 없음)
 */
export default function GuidePage() {
  const navigate = useNavigate()
  const [guide] = useState(loadGuide)
  const [chosen] = useState(loadChosenOption)
  const [arrivedByUser, setArrivedByUser] = useState(() => Boolean(guide?.arrivedAt))
  const [asked, setAsked] = useState(false)
  const [toast, showToast] = useToast()
  const now = useNow()

  const isTaxi = guide?.kind === 'groupTaxi'
  const state = !guide
    ? null
    : isTaxi
      ? taxiState(guide, now)
      : routeState(guide.option, guide, now)
  const arrived = Boolean(state?.arrived || arrivedByUser)
  useWakeLock(Boolean(guide) && !arrived)

  // 같은 경로를 고른 기록이면, 도착 화면에서 묻는 것으로 S7 팝업을 대신함 (한 번만)
  const askable =
    Boolean(chosen?.hasTaxi) &&
    !chosen?.askedAt &&
    chosen?.optionId === guide?.chosenId &&
    (!isTaxi || chosen?.group)
  useEffect(() => {
    if (arrived && askable && !asked) {
      markChosenAsked()
      setAsked(true)
    }
  }, [arrived, askable, asked])

  if (!guide) return <Navigate to="/" replace />

  const back = () => navigate(guide.backTo ?? '/', { state: guide.backState })
  function end() {
    clearGuide()
    back()
  }
  function markArrived() {
    updateGuide({ arrivedAt: Date.now() })
    setArrivedByUser(true)
  }
  async function handleCopy(text, message) {
    showToast((await copyText(text)) ? message : '복사하지 못했어요. 길게 눌러 복사해 주세요')
  }

  // ── 화면 데이터 ──
  let steps
  let bar
  let destination
  let startClock
  if (isTaxi) {
    const view = taxiView(guide)
    steps = view.steps
    bar = view.bar
    destination = guide.homeLabel
    startClock = guide.leaveAt.slice(11, 16)
  } else {
    const names = { origin: { label: guide.origin }, destination: { label: guide.destination } }
    steps = buildTimeline(guide.option, names, guide.departureIso)
    bar = guide.option.bar
    destination = guide.destination
    startClock = clockOf(new Date(guide.departureIso).getTime())
  }
  if (!arrived) {
    steps = isTaxi
      ? steps.map((s, i) => ({ ...s, now: i === 0 ? state.mark.text : undefined }))
      : markSteps(steps, state)
  }
  const minutes = Math.max(
    1,
    Math.round(
      (state.arrivalMs -
        (isTaxi ? new Date(`${guide.leaveAt}:00+09:00`) : new Date(guide.departureIso))) /
        60000,
    ),
  )

  // 모임 택시 정산 미리 보기 (S6 정산 박스 그대로, 마지막에 내리는 사람에게 보냄)
  const taxiGroup = isTaxi ? guide.group : null
  const transfers = taxiGroup
    ? taxiGroup.riders
        .filter((r) => r.member_id !== taxiGroup.payer_member_id)
        .map((r) => ({ groupIndex: 0, from: r.nickname, to: taxiGroup.payer, amount: r.share }))
    : []

  return (
    <div className={detail.page}>
      <AppBar
        leading="back"
        title={isTaxi ? '모임 길안내' : '길안내'}
        tone="canvas"
        wide
        onBack={back}
        action={{ label: arrived ? '닫기' : '끝내기', onClick: end }}
      />

      <div className={`page-body ${detail.layout}`} data-layout="wide">
        <aside className={detail.side}>
          {arrived ? (
            <Summary
              badges={[{ text: '도착', tone: 'primary' }]}
              big={`${destination} 도착`}
              meta={`${startClock} 출발 → ${clockOf(state.arrivalMs)} 도착 · ${minutes}분`}
              bar={bar}
            />
          ) : (
            <Summary {...state.top} bar={bar} />
          )}

          {/* 다음 탈 차를 놓쳤을 때 (서버 TIGHT_TRANSFER의 fallback_taxi) */}
          {!arrived && state.missed && (
            <section className={styles.missed} aria-label="놓쳤을 때">
              <p className="t-label-strong">놓쳤을 때</p>
              <p className={`${styles.missedDesc} t-body-small`}>{state.missed}</p>
            </section>
          )}

          {arrived && askable && (
            <section className={styles.ask}>
              <ArrivalQuestion
                chosen={chosen}
                inline
                onClose={() => {
                  // 건너뛰기도 길안내를 끝내고 메인(S1)으로
                  clearGuide()
                  navigate('/')
                }}
                onSubmitted={() => {
                  // 택시비를 보낸 뒤에는 길안내를 끝내고 메인(S1)으로
                  clearGuide()
                  navigate('/')
                }}
                onSettledClose={() => {
                  clearGuide()
                  navigate('/')
                }}
              />
            </section>
          )}

          {!arrived && (
            <div className={detail.actions}>
              <Button variant="secondary" className={styles.raised} onClick={markArrived}>
                {isTaxi && taxiGroup.riders.length > 1 ? '내렸어요 · 실제 총액 넣기' : '도착했어요'}
              </Button>
            </div>
          )}

          {arrived && !askable && (
            <div className={detail.actions}>
              <Button onClick={end}>{isTaxi ? '모임 화면으로' : '처음으로'}</Button>
            </div>
          )}

          <p className={`${detail.notice} t-caption`}>
            시각 기준 안내예요 · 실제 운행은 운영사 안내를 확인하세요
          </p>
        </aside>

        <div className={detail.timeline}>
          {!arrived && <Timeline steps={steps} />}
          {isTaxi && taxiGroup.riders.length > 1 && !arrived && (
            <div className={styles.settle}>
              <SettlementSection
                taxiGroups={[taxiGroup]}
                transfers={transfers}
                canSettle={false}
                onCopy={handleCopy}
              />
            </div>
          )}
        </div>
      </div>

      <Toast message={toast} />
    </div>
  )
}

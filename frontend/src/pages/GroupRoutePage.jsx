import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { sendEvent } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Icon from '../components/Icon.jsx'
import LegBar from '../components/LegBar.jsx'
import Timeline from '../components/Timeline.jsx'
import { loadGroupRoute, saveChosenOption, saveGuide } from '../utils/storage.js'
import { soloView, taxiView } from '../utils/routeViews.js'
import styles from './DetailPage.module.css'

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
    // 길안내 시작 (모임 택시 합승 / 혼자 가는 마감 경로)
    const common = {
      chosenId: view.chosen.optionId,
      groupId,
      groupName: payload.groupName,
      backTo: `/g/${groupId}`,
    }
    saveGuide(
      payload.detail.kind === 'taxi'
        ? {
            ...common,
            kind: 'groupTaxi',
            detail: payload.detail,
            group: payload.detail.group,
            meeting: payload.meeting,
            homeLabel: payload.homeLabel,
            leaveAt: payload.leaveAt,
            myId: payload.myId,
          }
        : {
            ...common,
            kind: 'route',
            origin: payload.meeting.label,
            destination: payload.homeLabel,
            departureIso: view.departureIso,
            option: view.option,
          },
    )
    navigate('/guide')
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
    </div>
  )
}

import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Icon from '../components/Icon.jsx'
import LegBar from '../components/LegBar.jsx'
import Timeline from '../components/Timeline.jsx'
import Toast from '../components/Toast.jsx'
import { TIMETABLE_DATE, buildRouteDetail } from '../data/routes.js'
import { useToast } from '../hooks/useToast.js'
import { formatFareRange } from '../utils/format.js'
import { loadSearch, saveChosenOption } from '../utils/storage.js'
import { departureMinutes, fromMinutes } from '../utils/time.js'
import styles from './DetailPage.module.css'

/** S3 경로 상세 /result/:optionId */
export default function DetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { optionId } = useParams()

  // 명세: 주소는 URL에 넣지 않음 → S2에서 넘긴 state, 새로고침이면 sessionStorage에서
  const [search] = useState(() => location.state ?? loadSearch())
  const [dep] = useState(() => (search ? departureMinutes(search.departure) : 0))
  const [toast, showToast] = useToast()

  if (!search) return <Navigate to="/" replace />
  const detail = buildRouteDetail(optionId, dep, search)
  if (!detail) return <Navigate to="/result" replace />

  const { option, steps } = detail
  const usesTaxi = option.legs.some((leg) => leg.mode === 'taxi')
  const backToResult = () => navigate('/result', { state: search })

  // 명세: 고른 안을 저장 → S7(도착 후 질문)에서 사용
  function choose() {
    saveChosenOption({
      optionId: option.id,
      badge: option.badge,
      title: option.title,
      origin: search.origin.name,
      destination: search.destination.name,
      departure: fromMinutes(dep),
      arrival: option.arrival,
      fareMin: option.fareMin,
      fareMax: option.fareMax,
    })
  }

  function handleKakao() {
    choose()
    // TODO(명세 11월 3주): 카카오 T에 출발·도착을 넘기는 링크 방식이 확정되면 연결
    showToast('카카오 T 연결은 준비 중이에요')
  }

  function handleChooseTransit() {
    choose()
    showToast('이 경로를 저장했어요')
  }

  async function handleShare() {
    const text = [
      `${search.origin.name} → ${search.destination.name}`,
      `${option.badge} ${formatFareRange(option.fareMin, option.fareMax)}`,
      ...steps.map((s) => `${s.time} ${s.title}`),
      '— MOVA',
    ].join('\n')
    try {
      if (navigator.share) {
        await navigator.share({ title: 'MOVA 경로', text })
        return
      }
      await navigator.clipboard.writeText(text)
      showToast('경로를 복사했어요')
    } catch (err) {
      if (err?.name !== 'AbortError') showToast('공유하지 못했어요')
    }
  }

  return (
    <div className={styles.page}>
      <AppBar
        leading="back"
        title={`${option.badge} 상세`}
        tone="canvas"
        wide
        onBack={backToResult}
        action={{ label: '공유', onClick: handleShare }}
      />

      {/* data-layout="wide": 데스크톱에서 넓은 레이아웃 사용 (index.css) */}
      <div className={`page-body ${styles.layout}`} data-layout="wide">
        {/* 데스크톱: 왼쪽에 요약·버튼 고정, 오른쪽에 타임라인. 모바일에서는 요약 → 타임라인 → 버튼 순 */}
        <aside className={styles.side}>
          <section className={styles.summary} aria-label="경로 요약">
            <div className={styles.badges}>
              <Badge tone={option.type === 'combo' ? 'primary' : 'default'}>{option.badge}</Badge>
              {!option.available && <Badge tone="muted">막차 끊김</Badge>}
            </div>

            <p className={`${styles.fare} ${!option.available ? styles.fareOff : ''} t-fare-l`}>
              {option.available ? (
                formatFareRange(option.fareMin, option.fareMax)
              ) : (
                <del>
                  <span className="sr-only">이용 불가, </span>
                  {formatFareRange(option.fareMin, option.fareMax)}
                </del>
              )}
            </p>

            <p className={`${styles.meta} t-body-small`}>
              {option.available ? (
                <>
                  {option.durationMin}분 · {fromMinutes(dep)} 출발
                  <Icon name="arrow-right" size={12} className={styles.metaArrow} />
                  {option.arrival} 도착
                </>
              ) : (
                option.unavailableReason
              )}
            </p>

            <LegBar legs={option.legs} />
          </section>

          <div className={styles.actions}>
            {!option.available ? (
              <Button variant="secondary" className={styles.raised} onClick={backToResult}>
                다른 안 보기
              </Button>
            ) : usesTaxi ? (
              <Button onClick={handleKakao}>카카오 T로 택시 부르기</Button>
            ) : (
              <Button onClick={handleChooseTransit}>이 경로로 갈게요</Button>
            )}
          </div>

          <p className={`${styles.notice} t-caption`}>
            시간표 기준일 {TIMETABLE_DATE} · 실제 운행 여부는 운영사에서 확인하세요
          </p>
        </aside>

        {steps.length > 0 && (
          <div className={styles.timeline}>
            <Timeline
              steps={steps}
              onKakao={handleKakao}
              onAlternative={() => navigate('/result/taxi', { state: search })}
            />
          </div>
        )}
      </div>

      <Toast message={toast} />
    </div>
  )
}

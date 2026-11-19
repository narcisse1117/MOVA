import { useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import Icon from '../components/Icon.jsx'
import Reveal from '../components/Reveal.jsx'
import RouteCard from '../components/RouteCard.jsx'
import { TIMETABLE_DATE, buildRouteOptions } from '../data/routes.js'
import { formatFareRange } from '../utils/format.js'
import { loadSearch } from '../utils/storage.js'
import { departureMinutes, fromMinutes } from '../utils/time.js'
import styles from './ResultPage.module.css'

/** S2 결과 /result */
export default function ResultPage() {
  const navigate = useNavigate()
  const location = useLocation()

  // 명세: 주소는 URL에 넣지 않음 → S1에서 넘긴 state, 새로고침이면 sessionStorage에서
  const [search] = useState(() => location.state ?? loadSearch())
  // '지금 출발'은 화면을 연 시각으로 고정
  const [dep] = useState(() => (search ? departureMinutes(search.departure) : 0))
  const options = useMemo(() => buildRouteOptions(dep), [dep])

  const [toast, setToast] = useState('')
  const toastTimer = useRef(0)

  if (!search) return <Navigate to="/" replace />

  const routeLabel = `${search.origin.name} → ${search.destination.name}`
  const departLabel = search.departure === 'now' ? '지금 출발' : `오늘 ${fromMinutes(dep)} 출발`

  function showToast(message) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2000)
  }

  async function handleShare() {
    const best = options[0]
    const text = `${routeLabel} · ${departLabel}\n${best.badge} ${formatFareRange(
      best.fareMin,
      best.fareMax,
    )}${best.arrival ? ` · ${best.arrival} 도착` : ''}\n— MOVA`

    try {
      if (navigator.share) {
        await navigator.share({ title: 'MOVA 경로', text })
        return
      }
      await navigator.clipboard.writeText(text)
      showToast('경로 요약을 복사했어요')
    } catch (err) {
      // 공유 창을 닫은 경우(AbortError)는 조용히 무시
      if (err?.name !== 'AbortError') showToast('공유하지 못했어요')
    }
  }

  return (
    <div className={styles.page}>
      <AppBar
        leading="back"
        title="경로 비교"
        tone="canvas"
        onBack={() => navigate('/', { state: { edit: true } })}
        action={{ label: '공유', onClick: handleShare }}
      />

      <div className="page-body">
        <section className={styles.summary} aria-label="검색 조건">
          <p className={`${styles.summaryText} t-label-medium`}>
            <span className={styles.route}>
              {search.origin.name}
              <Icon name="arrow-right" size={14} label="에서" />
              {search.destination.name}
            </span>
            {departLabel}
          </p>
          <button
            type="button"
            className={`${styles.edit} t-label-medium`}
            onClick={() => navigate('/', { state: { edit: true } })}
          >
            수정
          </button>
        </section>

        <p className={`${styles.caption} t-caption`}>추천순 · 금액은 100원 단위로 반올림했어요</p>

        <div className={styles.cards}>
          {options.map((option, i) => (
            <RouteCard
              key={option.id}
              option={option}
              index={i}
              highlighted={i === 0 && option.available}
              onDetail={() => navigate(`/result/${option.id}`, { state: search })}
              onAlternative={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            />
          ))}
        </div>

        <Button variant="secondary" className={styles.groupButton} onClick={() => navigate('/group/new')}>
          친구들과 같이 가기 (모임 모드)
        </Button>

        <p className={`${styles.caption} t-caption`}>
          시간표 기준일 {TIMETABLE_DATE} · 실제 운행 여부는 운영사에서 확인하세요
        </p>
      </div>

      <div className={styles.toastArea} aria-live="polite">
        <Reveal show={Boolean(toast)} variant="slide-up">
          <p className={`${styles.toast} t-body-medium-strong`}>{toast}</p>
        </Reveal>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import Icon from '../components/Icon.jsx'
import RouteCard from '../components/RouteCard.jsx'
import Toast from '../components/Toast.jsx'
import { useRouteSearch } from '../hooks/useRouteSearch.js'
import { useToast } from '../hooks/useToast.js'
import { formatFareRange } from '../utils/format.js'
import { loadSearch } from '../utils/storage.js'
import styles from './ResultPage.module.css'

/** '2026-11-16' → '2026.11.16' */
const dot = (d) => String(d).replaceAll('-', '.')

/**
 * 명세 C-04 기준일 안내. 서버 data_as_of에는 버스·심야버스 날짜만 있다
 * TODO(서버): 지하철 시간표 기준일(data_as_of.subway)이 생기면 함께 표시
 */
function dataAsOfText(asOf) {
  const parts = []
  if (asOf?.bus_official) parts.push(`버스 시간표 ${dot(asOf.bus_official)}`)
  if (asOf?.night_bus) parts.push(`심야버스 실측 ${dot(asOf.night_bus)}`)
  const base = parts.length ? `${parts.join(' · ')} 기준 · ` : ''
  return `${base}실제 운행은 운영사 안내를 확인하세요`
}

/** S2 결과 /result */
export default function ResultPage() {
  const navigate = useNavigate()
  const location = useLocation()

  // 명세: 주소는 URL에 넣지 않음 → S1에서 넘긴 state, 새로고침이면 sessionStorage에서
  const [search] = useState(() => {
    const s = location.state ?? loadSearch()
    return s?.origin?.lat != null && s?.destination?.lat != null ? s : null
  })
  const { status, data, error, slow, retry } = useRouteSearch(search)
  const [toast, showToast] = useToast()

  if (!search) return <Navigate to="/" replace />

  const departLabel = data?.departure
    ? search.departure === 'now'
      ? `지금(${data.departure}) 출발`
      : `${data.departure} 출발`
    : search.departure === 'now'
      ? '지금 출발'
      : `${search.departure} 출발`

  const options = data?.options ?? []
  const canRide = options.some((o) => o.available && o.kind !== 'taxi')
  const cut = data?.lastService?.regularCut ? data.lastService.regularLastDeparture : null
  const backToInput = () => navigate('/', { state: { edit: true } })

  async function handleShare() {
    const best = options.find((o) => o.recommended) ?? options.find((o) => o.available)
    if (!best) return
    const text = `${search.origin.label} → ${search.destination.label} · ${departLabel}\n${
      best.badges[0].text
    } ${formatFareRange(best.fareMin, best.fareMax)} · ${best.arrival} 도착\n— MOVA`
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
        wide
        onBack={backToInput}
        action={status === 'ready' ? { label: '공유', onClick: handleShare } : undefined}
      />

      {/* data-layout="wide": 데스크톱에서 넓은 레이아웃 사용 (index.css) */}
      <div className={`page-body ${styles.layout}`} data-layout="wide">
        <section className={styles.summary} aria-label="검색 조건">
          <p className={`${styles.summaryText} t-label-medium`}>
            <span className={styles.route}>
              {search.origin.label}
              <Icon name="arrow-right" size={14} label="에서" />
              {search.destination.label}
            </span>
            <span>{departLabel}</span>
          </p>
          <button type="button" className={`${styles.edit} t-label-medium`} onClick={backToInput}>
            수정
          </button>
        </section>

        {status === 'loading' && (
          // 명세 S2: 계산 중에는 카드 자리에 로딩 표시
          <div className={styles.cards} aria-busy="true" aria-live="polite">
            <p className={`${styles.caption} ${styles.full} t-caption`}>
              {slow
                ? '처음 검색은 1분 가까이 걸릴 수 있어요. 조금만 기다려 주세요'
                : '경로를 찾는 중이에요'}
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeleton} style={{ '--i': i }}>
                <span />
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        )}

        {status === 'error' && (
          <section className={styles.error} role="alert">
            <p className="t-heading-medium">경로를 찾지 못했어요</p>
            <p className={`${styles.caption} t-body-small`}>{error.message}</p>
            <Button variant="secondary" className={styles.raised} onClick={retry}>
              다시 찾기
            </Button>
          </section>
        )}

        {status === 'ready' && (
          <>
            {/* 서버 last_service: 일반 막차가 이미 끊긴 시각이면 알려 줌 */}
            {cut && canRide && (
              <p className={`${styles.banner} t-body-small`}>
                지하철·일반버스 막차({cut})가 지나서 심야버스와 택시로 안내해요
              </p>
            )}
            {/* 명세 오류 처리: 대중교통으로 갈 수 있는 안이 없음 */}
            {!canRide && (
              <p className={`${styles.banner} t-body-small`}>지금은 택시가 가장 나아요</p>
            )}

            <p className={`${styles.caption} t-caption`}>
              추천순 · 금액은 100원 단위로 반올림했어요
            </p>

            <div className={styles.cards}>
              {options.map((option, i) => (
                <RouteCard
                  key={option.id}
                  option={option}
                  index={i}
                  onDetail={() => navigate(`/result/${option.id}`, { state: search })}
                  onAlternative={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                />
              ))}
            </div>
          </>
        )}

        {/* 데스크톱: 안내 문구(왼쪽)와 모임 버튼(오른쪽)을 한 줄로. 모바일에서는 기존처럼 버튼 → 문구 */}
        <div className={styles.bottom}>
          <Button
            variant="secondary"
            className={styles.groupButton}
            onClick={() => navigate('/group/new')}
          >
            친구들과 같이 가기 (모임 모드)
          </Button>

          <p className={`${styles.caption} ${styles.notice} t-caption`}>
            {dataAsOfText(data?.dataAsOf)}
          </p>
        </div>
      </div>

      <Toast message={toast} />
    </div>
  )
}

import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { buildTimeline } from '../api/adapt.js'
import { sendEvent } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Icon from '../components/Icon.jsx'
import LegBar from '../components/LegBar.jsx'
import Timeline from '../components/Timeline.jsx'
import Toast from '../components/Toast.jsx'
import { useRouteSearch } from '../hooks/useRouteSearch.js'
import { useToast } from '../hooks/useToast.js'
import { formatFareRange } from '../utils/format.js'
import { loadSearch, saveChosenOption, saveGuide } from '../utils/storage.js'
import styles from './DetailPage.module.css'

/** 명세 C-04 기준일 안내 (서버 data_as_of: 버스·심야버스 날짜) */
function dataAsOfText(asOf) {
  const dot = (d) => String(d).replaceAll('-', '.')
  const parts = []
  if (asOf?.bus_official) parts.push(`버스 시간표 ${dot(asOf.bus_official)}`)
  if (asOf?.night_bus) parts.push(`심야버스 실측 ${dot(asOf.night_bus)}`)
  return `${parts.length ? `${parts.join(' · ')} 기준 · ` : ''}실제 운행은 운영사 안내를 확인하세요`
}

/** S3 경로 상세 /result/:optionId (optionId는 서버 option_id: combo-1, taxi, transit-1 …) */
export default function DetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { optionId } = useParams()

  // 명세: 주소는 URL에 넣지 않음 → S2에서 넘긴 state, 새로고침이면 sessionStorage에서
  const [search] = useState(() => {
    const s = location.state ?? loadSearch()
    return s?.origin?.lat != null && s?.destination?.lat != null ? s : null
  })
  // S2와 같은 검색이면 저장해 둔 응답을 그대로 씀 (서버에 다시 부르지 않음)
  const { status, data, error, retry } = useRouteSearch(search)
  const [toast, showToast] = useToast()

  if (!search) return <Navigate to="/" replace />
  const backToResult = () => navigate('/result', { state: search })

  if (status !== 'ready') {
    return (
      <div className={styles.page}>
        <AppBar leading="back" title="경로 상세" tone="canvas" wide onBack={backToResult} />
        <div className="page-body">
          <section className={styles.state} role={status === 'error' ? 'alert' : 'status'}>
            {status === 'error' ? (
              <>
                <p className="t-heading-medium">경로를 불러오지 못했어요</p>
                <p className={`${styles.notice} t-body-small`}>{error.message}</p>
                <Button variant="secondary" onClick={retry}>
                  다시 불러오기
                </Button>
              </>
            ) : (
              <p className={`${styles.notice} t-body-small`}>경로를 불러오는 중이에요</p>
            )}
          </section>
        </div>
      </div>
    )
  }

  const option = data.options.find((o) => o.id === optionId)
  if (!option) return <Navigate to="/result" replace state={search} />

  const steps = option.available ? buildTimeline(option, search, data.departureIso) : []
  const kindBadge = option.badges.find((b) => b.text !== '추천') ?? option.badges[0]

  // 명세: 고른 안을 저장 → S7(도착 후 질문)에서 POST /api/feedback으로 보낼 값까지
  function choose() {
    saveChosenOption({
      optionId: option.id,
      optionKind: option.kind,
      title: option.title,
      origin: search.origin.label,
      destination: search.destination.label,
      departure: data.departureIso,
      arrival: option.arrival,
      fareRange: [option.fareMin, option.fareMax],
      distanceM: option.taxiDistanceM,
      // S7(도착 후 질문): 택시를 탄 안만 묻고, 실제 택시비 + 대중교통 요금으로 실제 총액을 만든다
      hasTaxi: option.taxiDistanceM > 0 || option.kind === 'taxi',
      transitFare: option.transitFare,
      savingVsTaxi: option.savingVsTaxi,
    })
    sendEvent('select_option', { optionKind: option.kind })
  }

  // '이렇게 갈게요' → 고른 안 기록(S7) + 길안내 시작
  function handleChoose() {
    choose()
    saveGuide({
      kind: 'route',
      chosenId: option.id,
      origin: search.origin.label,
      destination: search.destination.label,
      departureIso: data.departureIso,
      option,
      backTo: `/result/${option.id}`,
      backState: search,
    })
    navigate('/guide')
  }

  async function handleShare() {
    const text = [
      `${search.origin.label} → ${search.destination.label}`,
      `${kindBadge.text} ${formatFareRange(option.fareMin, option.fareMax)}`,
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
        title={`${kindBadge.text} 상세`}
        tone="canvas"
        wide
        onBack={backToResult}
        action={option.available ? { label: '공유', onClick: handleShare } : undefined}
      />

      {/* data-layout="wide": 데스크톱에서 넓은 레이아웃 사용 (index.css) */}
      <div className={`page-body ${styles.layout}`} data-layout="wide">
        {/* 데스크톱: 왼쪽에 요약·버튼 고정, 오른쪽에 타임라인. 모바일에서는 요약 → 타임라인 → 버튼 순 */}
        <aside className={styles.side}>
          <section className={styles.summary} aria-label="경로 요약">
            <div className={styles.badges}>
              {option.badges.map((b) => (
                <Badge key={b.text} tone={b.tone}>
                  {b.text}
                </Badge>
              ))}
            </div>

            {option.available ? (
              <>
                <p className={`${styles.fare} t-fare-l`}>
                  {formatFareRange(option.fareMin, option.fareMax)}
                </p>
                <p className={`${styles.meta} t-body-small`}>
                  {option.durationMin}분 · {data.departure} 출발
                  <Icon name="arrow-right" size={12} className={styles.metaArrow} />
                  {option.arrival} 도착
                </p>
                <LegBar legs={option.bar} />
                {option.notices.map((n) => (
                  <p key={n.code} className={`${styles.notice} t-caption`}>
                    {n.message}
                  </p>
                ))}
              </>
            ) : (
              <p className={`${styles.meta} t-body-small`}>{option.message}</p>
            )}
          </section>

          <div className={styles.actions}>
            {!option.available ? (
              <Button variant="secondary" className={styles.raised} onClick={backToResult}>
                다른 안 보기
              </Button>
            ) : (
              // 명세 S3: '이렇게 갈게요' → 선택 기록
              <Button onClick={handleChoose}>이렇게 갈게요</Button>
            )}
          </div>

          <p className={`${styles.notice} t-caption`}>{dataAsOfText(data.dataAsOf)}</p>
        </aside>

        {steps.length > 0 && (
          <div className={styles.timeline}>
            <Timeline steps={steps} />
          </div>
        )}
      </div>

      <Toast message={toast} />
    </div>
  )
}

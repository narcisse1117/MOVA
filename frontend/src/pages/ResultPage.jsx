import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import { findRoutes, logEvent } from '../api.js'
import { loadSearch, saveResult } from '../utils/storage.js'
import {
  KIND_LABEL,
  delayText,
  fareText,
  hhmm,
  legSummary,
  savingText,
  sortCards,
} from '../utils/format.js'
import styles from './ResultPage.module.css'

/** S2 결과 /result — 카드 목록 (F2-01~03, F2-08) */
export default function ResultPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [search] = useState(() => state ?? loadSearch())
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!search) return
    const ctrl = new AbortController()
    findRoutes(search, ctrl.signal).then(
      (r) => {
        setResult(r)
        saveResult({ search, ...r })
        logEvent('search')
      },
      (err) => {
        if (err.name !== 'AbortError') setError(err.message || '경로를 찾지 못했어요')
      },
    )
    return () => ctrl.abort()
  }, [search])

  if (!search) {
    return (
      <>
        <AppBar leading="back" title="경로 비교" />
        <div className="page-body">
          <p className="t-body-medium">검색 조건이 없어요.</p>
          <Button onClick={() => navigate('/')}>처음으로</Button>
        </div>
      </>
    )
  }

  const last = result?.last_service
  const asOf = result?.data_as_of

  return (
    <>
      <AppBar leading="back" title="경로 비교" />
      <div className="page-body">
        <section className={styles.summary}>
          <p className="t-heading-medium">
            {search.origin.name} → {search.destination.name}
          </p>
          <p className={`${styles.muted} t-body-small`}>
            {result ? `${hhmm(result.departure)} 출발` : search.departure === 'now' ? '지금 출발' : `${search.departure} 출발`}
          </p>
        </section>

        {last?.regular_cut && (
          <p className={`${styles.cut} t-body-small`} role="status">
            지하철·일반버스 막차 {hhmm(last.regular_last_departure)} 끊김 — 심야버스와 택시로 찾았어요
          </p>
        )}

        {error && (
          <div className={styles.errorBox} role="alert">
            <p className="t-body-medium">{error}</p>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              다시 찾기
            </Button>
          </div>
        )}

        {!result && !error && (
          <div className={styles.list} aria-busy="true" aria-label="경로 계산 중">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${styles.card} ${styles.skeleton}`} />
            ))}
          </div>
        )}

        {result && (
          <ul className={styles.list}>
            {sortCards(result.options).map((o) => (
              <li key={o.option_id}>
                <OptionCard option={o} />
              </li>
            ))}
          </ul>
        )}

        {asOf && (
          <p className={`${styles.muted} t-caption`}>
            버스 첫차·막차 {asOf.bus_official} 기준
            {asOf.night_bus && ` · 심야버스 ${asOf.night_bus} 밤 실측`}
            {' · '}택시 요금은 예상 범위예요
          </p>
        )}
      </div>
    </>
  )
}

function OptionCard({ option: o }) {
  if (!o.available) {
    return (
      <div className={`${styles.card} ${styles.disabled}`}>
        <div className={styles.head}>
          <Badge>{KIND_LABEL[o.kind]}</Badge>
          <span className={`${styles.cutTag} t-caption-strong`}>막차 끊김</span>
        </div>
        <p className="t-body-medium">{o.message}</p>
      </div>
    )
  }
  const saving = savingText(o)
  const delay = delayText(o)
  const tight = o.warnings.find((w) => w.code === 'TIGHT_TRANSFER')
  const night = o.legs.some((l) => l.night)
  return (
    <Link to={`/result/${o.option_id}`} className={`${styles.card} ${o.recommended ? styles.recommended : ''}`}>
      <div className={styles.head}>
        {o.recommended && <span className={`${styles.pick} t-badge`}>추천</span>}
        <Badge>{KIND_LABEL[o.kind]}</Badge>
        {night && <Badge>심야버스</Badge>}
      </div>
      <div className={styles.row}>
        <span className="t-fare-m">{fareText(o.fare_range)}</span>
        <span className="t-heading-medium">{hhmm(o.arrival)} 도착</span>
      </div>
      <p className={`${styles.muted} t-body-small`}>
        {o.duration_min}분{o.kind !== 'taxi' && ` · ${legSummary(o.legs)}`}
      </p>
      {(saving || delay) && (
        <p className={`${styles.compare} t-body-medium-strong`}>{[saving, delay].filter(Boolean).join(' · ')}</p>
      )}
      {tight && <p className={`${styles.warn} t-caption`}>⚠ {tight.message}</p>}
    </Link>
  )
}

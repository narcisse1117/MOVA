import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import { logEvent } from '../api.js'
import { loadResult, saveChoice } from '../utils/storage.js'
import { KIND_LABEL, delayText, fareText, hhmm, minutes, savingText, won } from '../utils/format.js'
import styles from './ResultPage.module.css'

/** S3 경로 상세 /result/:optionId — 구간별 타임라인 (F1-12·13) */
export default function DetailPage() {
  const { optionId } = useParams()
  const navigate = useNavigate()
  const [result] = useState(loadResult)
  const [chosen, setChosen] = useState(false)
  const o = result?.options.find((x) => x.option_id === optionId)

  if (!o || !o.available) {
    return (
      <>
        <AppBar leading="back" title="경로 상세" />
        <div className="page-body">
          <p className="t-body-medium">경로 정보가 없어요. 다시 검색해 주세요.</p>
          <Button onClick={() => navigate('/')}>처음으로</Button>
        </div>
      </>
    )
  }

  const tight = Object.fromEntries(
    o.warnings.filter((w) => w.code === 'TIGHT_TRANSFER').map((w) => [w.at, w]),
  )
  const notes = o.warnings.filter((w) => w.code !== 'TIGHT_TRANSFER')

  function choose() {
    saveChoice({
      option_id: o.option_id,
      option_kind: o.kind,
      fare_range: o.fare_range,
      departure: result.departure,
      saving: o.saving_vs_taxi,
      chosen_at: new Date().toISOString(),
    })
    logEvent('select_option', { option_kind: o.kind })
    setChosen(true)
  }

  return (
    <>
      <AppBar leading="back" title="경로 상세" />
      <div className="page-body">
        <section className={styles.summary}>
          <div className={styles.head}>
            {o.recommended && <span className={`${styles.pick} t-badge`}>추천</span>}
            <Badge>{KIND_LABEL[o.kind]}</Badge>
          </div>
          <div className={styles.row}>
            <span className="t-fare-l">{fareText(o.fare_range)}</span>
            <span className="t-heading-large">{hhmm(o.arrival)} 도착</span>
          </div>
          <p className={`${styles.muted} t-body-small`}>
            {hhmm(result.departure)} 출발 · {o.duration_min}분
            {o.kind !== 'taxi' && ` · ${[savingText(o), delayText(o)].filter(Boolean).join(' · ')}`}
          </p>
        </section>

        <ol className={styles.timeline}>
          {o.legs.map((l, i) => (
            <Leg key={i} leg={l} tight={tight[l.from]} />
          ))}
          <li className={styles.step}>
            <span className="t-heading-medium">도착 {hhmm(o.arrival)}</span>
          </li>
        </ol>

        {notes.map((w) => (
          <p key={w.code} className={`${styles.muted} t-caption`}>
            ※ {w.message}
          </p>
        ))}

        <div className={styles.actions}>
          {chosen ? (
            <p className="t-body-medium-strong" role="status">
              좋아요! 도착하고 나서 실제 택시비를 알려 주시면 다음 계산이 더 정확해져요.
            </p>
          ) : (
            <Button onClick={choose}>이렇게 갈게요</Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/result')}>
            다른 안 보기
          </Button>
        </div>
      </div>
    </>
  )
}

function Leg({ leg: l, tight }) {
  if (l.type === 'walk') {
    return (
      <li className={`${styles.step} ${styles.walk}`}>
        <span className="t-body-small">
          걷기 {minutes(l.duration_sec)}분 · {l.to === '도착지' ? '도착지까지' : `${l.to}까지`}
        </span>
      </li>
    )
  }
  if (l.type === 'taxi') {
    return (
      <li className={`${styles.step} ${styles.ride}`}>
        <span className="t-heading-medium">
          택시 {hhmm(l.departure)} · {l.from}
        </span>
        <span className="t-body-small">
          {l.to}까지 {(l.distance_m / 1000).toFixed(1)}km · {minutes(l.drive_sec)}분 · {fareText(l.fare_range)}
        </span>
        <span className={`${styles.muted} t-caption`}>
          호출 대기 약 {minutes(l.wait_sec)}분 포함{l.estimated ? ' · 교통 정보 없이 추정' : ''}
        </span>
        <CopyButton text={l.to === '도착지' ? null : l.to} />
      </li>
    )
  }
  const name = l.type === 'subway' ? l.line : `${l.line}번 버스`
  return (
    <li className={`${styles.step} ${styles.ride}`}>
      <span className="t-heading-medium">
        {name} {hhmm(l.departure)} · {l.from}
      </span>
      <span className="t-body-small">
        {l.to} {hhmm(l.arrival)} 하차 · {l.stops}정거장
      </span>
      <span className={styles.head}>
        {l.night && <Badge>심야버스</Badge>}
        {l.is_last && <Badge>막차</Badge>}
        {l.timetable === 'estimate' && <Badge>시각 추정</Badge>}
        {l.timetable === 'observed' && <Badge>실측 시간표</Badge>}
      </span>
      {tight && (
        <p className={`${styles.alert} t-caption`}>
          ⚠ {tight.message}. 놓치면 {tight.fallback_taxi.from}에서 택시 약 {won(tight.fallback_taxi.fare)}
        </p>
      )}
    </li>
  )
}

/** F1-14 대신: 택시 탈 곳 이름을 복사해서 호출 앱에 붙여 넣는다 (앱 바로 열기는 확인 후 추가) */
function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      className={`${styles.muted} t-caption-medium`}
      style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: '4px 0', textDecoration: 'underline' }}
      onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}
    >
      {done ? '복사했어요' : '탈 곳 이름 복사'}
    </button>
  )
}

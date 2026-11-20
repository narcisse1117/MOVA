import { useEffect, useRef, useState } from 'react'
import { sendEvent, sendFeedback, settle } from '../api/index.js'
import { copyText, shareOrCopy } from '../utils/clipboard.js'
import { round100 } from '../utils/format.js'
import { getSessionId, loadChosenOption, markChosenAsked } from '../utils/storage.js'
import { hhmmOf, seoulLocal } from '../utils/time.js'
import Button from './Button.jsx'
import Reveal from './Reveal.jsx'
import styles from './FeedbackPrompt.module.css'

const HOUR = 3600 * 1000
const won = (n) => `${n.toLocaleString('ko-KR')}원`

/**
 * 명세 F2-09: 안을 고르고 다음에 앱을 열면(또는 출발 3시간 뒤까지) 실제 택시비를 묻는다. 한 검색에 한 번만
 * - 택시를 타는 안(택시 직행·조합)을 골랐을 때만
 * - 출발 시각이 지난 뒤에만, 하루가 지나면 묻지 않음
 */
function shouldAsk(chosen, now = Date.now()) {
  if (!chosen || chosen.askedAt || !chosen.hasTaxi || !chosen.departure) return false
  const departure = new Date(chosen.departure).getTime()
  if (now < departure || now - departure > 24 * HOUR) return false
  const nextVisit = chosen.sessionId !== getSessionId()
  return nextVisit || now - departure >= 3 * HOUR
}

const toNumber = (text) => {
  const n = Number(String(text).replace(/[^\d]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 05시 기준 운행일 (새벽은 전날 밤) */
const serviceDay = (ms) => seoulLocal(ms - 5 * HOUR).slice(0, 10)

/** '2026-11-06T23:40:00+09:00' → '11/6 23:40' */
function shortDateTime(iso) {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)} ${hhmmOf(iso)}`
}

const KIND_LABEL = { taxi: '택시', combo: '대중교통 + 택시' }
const QUICK = [
  { id: 'same', label: '예상과 비슷' },
  { id: 'more', label: '더 나왔어요' },
  { id: 'less', label: '덜 나왔어요' },
]

/**
 * S7 도착 후 질문 (와이어프레임 S7: 모바일 바텀시트, 데스크톱 가운데 팝업)
 * 실제 택시비 → POST /api/feedback (실제 총액 = 택시비 + 대중교통 요금) → 절약액과 공유 (F2-11)
 * 서버는 금액(actual_fare)을 받으므로 '더/덜 나왔어요'는 금액을 넣게 안내만 하고, '예상과 비슷'은 예상 가운데 값을 채움
 * 모임 택시(내 경로에서 '이렇게 갈게요')를 골랐으면: 실제 총액 → POST /api/settle로 다시 나눠
 * 누가 누구에게 얼마 보낼지 보여주고 복사 (명세 S7 '모임이면 실제 총액 입력 → 재정산', F3-22)
 * 서버가 다시 나눈 결과를 모임에 저장하지 않아서 복사해 단톡방에 보내게 한다
 */
export default function FeedbackPrompt() {
  const [chosen, setChosen] = useState(null)
  const [fare, setFare] = useState('')
  const [quick, setQuick] = useState(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState('ask') // ask | sending | done | closed
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    function check() {
      const c = loadChosenOption()
      if (!shouldAsk(c)) return
      markChosenAsked() // 한 검색에 한 번만
      setChosen(c)
    }
    check()
    const onVisible = () => !document.hidden && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!chosen) return null
  const open = step !== 'closed'
  const transit = chosen.transitFare ?? 0
  const [min, max] = chosen.fareRange ?? [0, 0]
  // 택시 부분 예상 (이 안의 요금 범위에서 대중교통 요금을 뺀 가운데 값)
  const taxiExpected = round100(Math.max((min + max) / 2 - transit, 0))
  // 모임 택시 합승이면 총액을 묻고 다시 나눔
  const group = chosen.group ?? null
  const expected = group ? round100(group.estimatedTotal) : taxiExpected
  const departureMs = new Date(chosen.departure).getTime()
  const when = serviceDay(Date.now()) > serviceDay(departureMs) ? '어젯밤' : '오늘 밤'

  function close() {
    setStep('closed')
  }

  function skip() {
    if (!group) sendFeedback({ ...chosen, actualFare: null }).catch(() => {})
    close()
  }

  function pickQuick(id) {
    setQuick(id)
    setError('')
    if (id === 'same') setFare(String(expected))
    else {
      setFare('')
      inputRef.current?.focus()
    }
  }

  async function submit(e) {
    e.preventDefault()
    const taxiFare = toNumber(fare)
    if (!taxiFare) {
      setError(quick ? '얼마였는지 금액을 넣어 주세요' : '실제 택시비를 넣어 주세요')
      inputRef.current?.focus()
      return
    }
    if (group) {
      setStep('sending')
      try {
        const res = await settle({ riders: group.riders, totalFare: taxiFare })
        setResult({ settle: res })
        setStep('done')
        sendEvent('group_settle')
      } catch (err) {
        setError(err.message)
        setStep('ask')
      }
      return
    }
    const actualTotal = taxiFare + transit
    setStep('sending')
    const res = await sendFeedback({ ...chosen, actualFare: actualTotal }).catch(() => null)
    // F2-07: 절약액 = 택시 직행 가운데 값 - 이 안의 가운데 값 → 실제 총액으로 다시
    const taxiDirectMid = (min + max) / 2 + (chosen.savingVsTaxi ?? 0)
    const saving =
      chosen.optionKind === 'taxi' || chosen.savingVsTaxi == null
        ? 0
        : round100(taxiDirectMid - actualTotal)
    setResult({ saving, withinRange: res?.within_range ?? null })
    setStep('done')
  }

  // F2-11 공유 (문구에 앱 링크)
  async function share() {
    const text =
      result?.saving > 0
        ? `MOVA로 ${chosen.origin} → ${chosen.destination}, 택시만 탈 때보다 ${won(result.saving)} 아꼈어요`
        : '밤늦게 집에 갈 때 택시와 대중교통을 섞은 가장 싼 길을 찾아줘요'
    const outcome = await shareOrCopy({ title: 'MOVA', text, url: window.location.origin })
    if (outcome !== 'cancelled') sendEvent('share_saving', { optionKind: chosen.optionKind })
  }

  async function copySettle() {
    const r = result.settle
    const text = [
      `${chosen.title} 실제 ${won(r.total_fare)} 정산 (MOVA)`,
      ...r.transfers.map((t) => `${t.from} → ${t.to} ${won(t.amount)}`),
      '같이 탄 구간은 나누고, 혼자 탄 구간은 혼자 내요',
    ].join('\n')
    if (await copyText(text)) setCopied(true)
  }

  const shareButton = (
    <Button variant="secondary" onClick={share}>
      친구에게 MOVA 공유하기
    </Button>
  )

  return (
    <Reveal show={open} variant="fade">
      <div className={styles.backdrop} onClick={step === 'done' ? close : undefined}>
        <section
          className={styles.sheet}
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && (step === 'done' ? close() : skip())}
        >
          <span className={styles.handle} aria-hidden="true" />
          {step !== 'done' ? (
            <form className={styles.body} onSubmit={submit} noValidate>
              <h2 id="feedback-title" className="t-title-medium">
                {when} 택시비{group ? ' 총액' : ''}, 얼마 나왔나요?
              </h2>
              <p className={`${styles.muted} t-body-small`}>
                {shortDateTime(chosen.departure)} {chosen.origin} → {chosen.destination}
                <br />
                고른 안: {KIND_LABEL[chosen.optionKind] ?? chosen.title} ({group ? '총' : '택시'}{' '}
                예상 약 {won(expected)})
              </p>

              <label className={styles.field}>
                <span className="t-label-medium">
                  {group ? '실제 택시비 (총액)' : '실제 택시비'}
                </span>
                <span className={styles.input}>
                  <input
                    ref={inputRef}
                    className="t-body-large"
                    inputMode="numeric"
                    placeholder={`예: ${(expected + 500).toLocaleString('ko-KR')}`}
                    value={fare}
                    onChange={(e) => {
                      setFare(e.target.value)
                      setError('')
                    }}
                    autoFocus
                  />
                  <span className={`${styles.muted} t-body-medium`}>원</span>
                </span>
              </label>

              <div className={styles.chips} role="group" aria-label="빠른 답">
                {QUICK.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={`${styles.chip} ${quick === q.id ? styles.chipOn : ''} t-caption-medium`}
                    aria-pressed={quick === q.id}
                    onClick={() => pickQuick(q.id)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>

              {error && (
                <p className={`${styles.error} t-body-small`} role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={step === 'sending'}>
                {step === 'sending' ? '보내는 중…' : '알려주기'}
              </Button>
              <button type="button" className={`${styles.skip} t-body-small`} onClick={skip}>
                건너뛰기
              </button>
              <hr className={styles.divider} />
              {shareButton}
            </form>
          ) : result.settle ? (
            // 모임: 실제 총액으로 다시 나눈 결과
            <div className={styles.body}>
              <h2 id="feedback-title" className="t-title-medium">
                실제 {won(result.settle.total_fare)}으로 다시 나눴어요
              </h2>
              <ul className={styles.transfers}>
                {result.settle.transfers.map((t) => (
                  <li key={`${t.from}-${t.to}`}>
                    <span className="t-body-medium">
                      {t.from} → {t.to}
                    </span>
                    <span className="t-heading-medium">{won(t.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className={`${styles.muted} t-caption`}>
                같이 탄 구간은 나누고, 혼자 탄 구간은 혼자 내요 · 다시 나눈 금액은 이 기기에만
                보여요
              </p>
              <Button onClick={copySettle}>
                {copied ? '복사했어요. 단톡방에 붙여 넣어 주세요' : '정산 내용 복사해서 보내기'}
              </Button>
              <button type="button" className={`${styles.skip} t-body-small`} onClick={close}>
                닫기
              </button>
            </div>
          ) : (
            <div className={styles.body}>
              <h2 id="feedback-title" className="t-title-medium">
                {result.saving > 0 ? `오늘 ${won(result.saving)} 아꼈어요` : '알려 줘서 고마워요'}
              </h2>
              <p className={`${styles.muted} t-body-small`}>
                {result.withinRange === true && '예상한 범위 안이었어요. '}
                {result.withinRange === false && '예상과 달랐어요. 다음 계산에 반영할게요. '}
                {result.saving > 0 && '택시만 탔을 때(예상 가운데 값)와 비교한 금액이에요'}
              </p>
              {shareButton}
              <button type="button" className={`${styles.skip} t-body-small`} onClick={close}>
                닫기
              </button>
            </div>
          )}
        </section>
      </div>
    </Reveal>
  )
}

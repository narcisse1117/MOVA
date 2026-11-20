import { useState } from 'react'
import { settle } from '../api/index.js'
import { formatWon } from '../utils/format.js'
import { hhmmOf } from '../utils/time.js'
import Badge from './Badge.jsx'
import Button from './Button.jsx'
import Reveal from './Reveal.jsx'
import styles from './TaxiGroupCard.module.css'

const won = (n) => `${n.toLocaleString('ko-KR')}원` // 정산 금액은 10원 단위 그대로
const toNumber = (text) => {
  const n = Number(String(text).replace(/[^\d]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 단톡방에 붙여 넣을 정산 문구 */
function settleText(no, result) {
  return [
    `택시 ${no} 실제 ${won(result.total_fare)} 정산 (MOVA)`,
    ...result.transfers.map((t) => `${t.from} → ${t.to} ${won(t.amount)}`),
    '같이 탄 구간은 나누고, 혼자 탄 구간은 혼자 내요',
  ].join('\n')
}

/**
 * S6 택시 묶음 카드 (서버 taxi_groups 한 대)
 * - 탈 사람(내리는 순서), 내리는 시각, 각자 낼 몫(예상), 혼자 탔으면
 * - 낸 사람(마지막에 내림)과 누가 누구에게 얼마 보내는지 (settlement, 예상)
 * - 내린 뒤 실제 총액(선택: 각자 내릴 때 미터기)을 넣으면 POST /api/settle로 다시 나눔.
 *   서버에 저장되지 않아서 결과는 이 기기에만 보이므로 복사해서 보내게 한다
 * 송금은 하지 않는다 (README: 금액만 보여주고 각자 보낸다)
 */
export default function TaxiGroupCard({ no, group, transfers, myMemberId, canSettle, onCopy }) {
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState('')
  const [meters, setMeters] = useState({}) // member_id → 내릴 때 미터기 (선택)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const shared = group.riders.length > 1
  const totalFare = toNumber(total)

  async function handleSettle(e) {
    e.preventDefault()
    if (!totalFare) {
      setError('실제로 낸 택시비를 넣어 주세요')
      return
    }
    // 마지막 사람 앞까지 모두 미터기를 넣었을 때만 actual_meter로 보냄 (README: 가장 정확)
    const allMeters = group.riders.slice(0, -1).every((r) => toNumber(meters[r.member_id]))
    const riders = group.riders.map((r, i) => ({
      nickname: r.nickname,
      member_id: r.member_id,
      estimated_meter: group.estimated_meters?.[i] ?? r.meter_at_dropoff,
      ...(allMeters
        ? {
            actual_meter: i === group.riders.length - 1 ? totalFare : toNumber(meters[r.member_id]),
          }
        : {}),
    }))
    setError('')
    setBusy(true)
    try {
      setResult(await settle({ riders, totalFare }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const shown = result
    ? Object.fromEntries(result.shares.map((s) => [s.member_id ?? s.nickname, s.share]))
    : null

  return (
    <section className={styles.card} aria-label={`택시 ${no}`}>
      <header className={styles.head}>
        <p className="t-heading-medium">
          택시 {no} · {group.riders.length}명
        </p>
        <Badge tone={result ? 'primary' : 'default'}>{result ? '실제 금액' : '예상'}</Badge>
        <span className={styles.total}>
          <span className="t-caption">총</span>
          <span className="t-fare-s">{won(result?.total_fare ?? group.total_fare)}</span>
        </span>
      </header>

      {/* 탈 사람: 내리는 순서 */}
      <ol className={styles.riders}>
        {group.riders.map((r, i) => {
          const isPayer = r.member_id === group.payer_member_id
          const share = shown ? (shown[r.member_id] ?? shown[r.nickname]) : r.share
          return (
            <li key={r.member_id} className={styles.rider}>
              <span className={`${styles.order} t-caption-strong`}>{i + 1}</span>
              <div className={styles.riderBody}>
                <p className="t-body-medium-strong">
                  {r.nickname}
                  {r.member_id === myMemberId && <span className={styles.me}> (나)</span>}
                  {isPayer && shared && <Badge tone="white">택시비 내요</Badge>}
                </p>
                <p className={`${styles.muted} t-caption`}>
                  {hhmmOf(r.arrival)} 하차
                  {!result &&
                    shared &&
                    r.solo_fare > r.share &&
                    ` · 혼자면 ${formatWon(r.solo_fare)}`}
                </p>
              </div>
              <span className="t-body-medium-strong">{won(share)}</span>
            </li>
          )
        })}
      </ol>

      {shared && (
        <>
          <p className={`${styles.muted} t-caption`}>
            마지막에 내리는 {group.payer}님이 택시비를 내고, 나머지가 {group.payer}님에게 보내요
          </p>

          {/* 누가 누구에게 얼마 (송금은 각자) */}
          <ul className={styles.transfers}>
            {(result?.transfers ?? transfers).map((t) => (
              <li key={`${t.from}-${t.to}`} className={styles.transfer}>
                <span className="t-body-small">
                  {t.from} → {t.to}
                </span>
                <span className="t-body-medium-strong">{won(t.amount)}</span>
                <button
                  type="button"
                  className={`${styles.copy} t-label-medium`}
                  onClick={() => onCopy(String(t.amount), `${won(t.amount)}을 복사했어요`)}
                >
                  금액 복사
                </button>
              </li>
            ))}
          </ul>

          {result && (
            <Button
              variant="secondary"
              className={styles.raised}
              onClick={() => onCopy(settleText(no, result), '정산 내용을 복사했어요')}
            >
              정산 내용 복사해서 보내기
            </Button>
          )}

          {canSettle && (
            <>
              <button
                type="button"
                className={`${styles.toggle} t-label-medium`}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                {result ? '실제 금액 다시 넣기' : '내린 뒤 실제 금액 넣기'}
              </button>
              <Reveal show={open} gap={0}>
                <form className={styles.settle} onSubmit={handleSettle} noValidate>
                  <label className={styles.input}>
                    <span className="t-label-medium">실제로 낸 택시비 (총액)</span>
                    <input
                      className="t-body-large"
                      inputMode="numeric"
                      placeholder={`예상 ${won(group.total_fare)}`}
                      value={total}
                      onChange={(e) => setTotal(e.target.value)}
                    />
                  </label>
                  <p className={`${styles.muted} t-caption`}>
                    내릴 때 미터기 금액도 넣으면 더 정확하게 나눠요 (선택)
                  </p>
                  {group.riders.slice(0, -1).map((r, i) => (
                    <label key={r.member_id} className={styles.input}>
                      <span className="t-label-medium">{r.nickname} 내릴 때 미터기</span>
                      <input
                        className="t-body-large"
                        inputMode="numeric"
                        placeholder={`예상 ${won(group.estimated_meters?.[i] ?? r.meter_at_dropoff)}`}
                        value={meters[r.member_id] ?? ''}
                        onChange={(e) =>
                          setMeters((m) => ({ ...m, [r.member_id]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                  {error && (
                    <p className={`${styles.error} t-body-small`} role="alert">
                      {error}
                    </p>
                  )}
                  <Button type="submit" disabled={busy}>
                    {busy ? '나누는 중…' : '다시 나누기'}
                  </Button>
                  <p className={`${styles.muted} t-caption`}>
                    다시 나눈 금액은 이 기기에만 보여요. 복사해서 단톡방에 보내 주세요
                  </p>
                </form>
              </Reveal>
            </>
          )}
        </>
      )}
    </section>
  )
}

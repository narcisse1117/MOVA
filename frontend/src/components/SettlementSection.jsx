import { useState } from 'react'
import { settle } from '../api/index.js'
import { won } from '../utils/groupPlan.js'
import Button from './Button.jsx'
import Reveal from './Reveal.jsx'
import styles from './SettlementSection.module.css'

const toNumber = (text) => {
  const n = Number(String(text).replace(/[^\d]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * S6 정산 (와이어프레임 S6 오른쪽 '정산')
 * - 정산 규칙 한 줄 항상 (F3-24). 문구는 서버 규칙(구간을 탄 사람끼리 똑같이, 10원 단위)에 맞춤
 * - 누가 누구에게 얼마 + 금액 복사
 *   와이어프레임의 '토스로 보내기 · 카카오페이로 보내기'는 README에서 송금 링크를 만들지 않는다고 해서 뺌
 * - 택시에서 내린 뒤 실제 총액으로 다시 나누기 (POST /api/settle, 서버에 저장되지 않음 → 이 기기에만)
 */
export default function SettlementSection({ taxiGroups, transfers, canSettle, onCopy }) {
  const [results, setResults] = useState({}) // 택시 묶음 key → settle 응답

  const keyOf = (g) => g.riders.map((r) => r.member_id).join('-')
  const shared = taxiGroups
    .map((g, index) => ({ g, index, key: keyOf(g) }))
    .filter(({ g }) => g.riders.length > 1)

  // 실제 금액으로 다시 나눈 묶음은 그 결과로 바꿔서 보여줌
  const rows = shared.flatMap(({ index, key }) => {
    const actual = results[key]
    if (actual) {
      return actual.transfers.map((t) => ({ ...t, key: `${key}-${t.from}`, actual: true }))
    }
    return transfers
      .filter((t) => t.groupIndex === index)
      .map((t) => ({ ...t, key: `${key}-${t.from}`, actual: false }))
  })

  return (
    <section className={styles.section} aria-label="정산">
      <h2 className="t-heading-medium">정산</h2>
      <p className={`${styles.rule} t-caption`}>
        정산 규칙: 같이 탄 구간은 나누고, 혼자 탄 구간은 혼자 내요 · 10원 단위
      </p>

      {rows.length === 0 ? (
        <p className={`${styles.empty} t-body-small`}>같이 타는 택시가 없어서 보낼 돈이 없어요</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((t) => (
            <li key={t.key} className={styles.transfer}>
              <div className={styles.head}>
                <span className="t-body-medium-strong">
                  {t.from} → {t.to}
                </span>
                <span className="t-fare-s">{won(t.amount)}</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="t-body-small"
                  onClick={() => onCopy(String(t.amount), `${won(t.amount)}을 복사했어요`)}
                >
                  금액 복사
                </button>
              </div>
              {!t.actual && <span className={`${styles.muted} t-caption`}>예상 금액</span>}
            </li>
          ))}
        </ul>
      )}

      {canSettle &&
        shared.map(({ g, index, key }) => (
          <ActualFare
            key={key}
            no={shared.length > 1 ? index + 1 : null}
            group={g}
            result={results[key]}
            onResult={(r) => setResults((all) => ({ ...all, [key]: r }))}
            onCopy={onCopy}
          />
        ))}
    </section>
  )
}

/** 내린 뒤 실제 총액(선택: 각자 내릴 때 미터기)으로 다시 나누기 */
function ActualFare({ no, group, result, onResult, onCopy }) {
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState('')
  const [meters, setMeters] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const label = no ? `택시 ${no}` : '택시'

  async function submit(e) {
    e.preventDefault()
    const totalFare = toNumber(total)
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
      onResult(await settle({ riders, totalFare }))
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const text = result
    ? [
        `${label} 실제 ${won(result.total_fare)} 정산 (MOVA)`,
        ...result.transfers.map((t) => `${t.from} → ${t.to} ${won(t.amount)}`),
        '같이 탄 구간은 나누고, 혼자 탄 구간은 혼자 내요',
      ].join('\n')
    : ''

  return (
    <div className={styles.actual}>
      <div className={styles.actualHead}>
        <button
          type="button"
          className={`${styles.toggle} t-label-medium`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {result ? `${label} 실제 금액 다시 넣기` : `${label} 내린 뒤 실제 금액 넣기`}
        </button>
        {result && (
          <button
            type="button"
            className={`${styles.toggle} t-label-medium`}
            onClick={() => onCopy(text, '정산 내용을 복사했어요')}
          >
            정산 내용 복사
          </button>
        )}
      </div>
      <Reveal show={open} gap={0}>
        <form className={styles.form} onSubmit={submit} noValidate>
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
          {group.riders.slice(0, -1).map((r, i) => (
            <label key={r.member_id} className={styles.input}>
              <span className="t-label-medium">{r.nickname} 내릴 때 미터기 (선택)</span>
              <input
                className="t-body-large"
                inputMode="numeric"
                placeholder={`예상 ${won(group.estimated_meters?.[i] ?? r.meter_at_dropoff)}`}
                value={meters[r.member_id] ?? ''}
                onChange={(e) => setMeters((m) => ({ ...m, [r.member_id]: e.target.value }))}
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
    </div>
  )
}

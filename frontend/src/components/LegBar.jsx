import { LEG_MODES } from '../data/routes.js'
import Icon from './Icon.jsx'
import styles from './LegBar.module.css'

/**
 * 구간 막대 — 이동 수단별 칸이 걸리는 시간에 비례한 너비로 나열됨
 * @param {{mode: keyof LEG_MODES, minutes: number}[]} legs
 */
export default function LegBar({ legs }) {
  const summary = legs
    .map((l) => (l.mode === 'none' ? '연결 없음' : `${LEG_MODES[l.mode]} ${l.minutes}분`))
    .join(', ')

  return (
    <div className={styles.bar} role="img" aria-label={`구간: ${summary}`}>
      {legs.map((leg, i) => (
        <span
          key={i}
          className={`${styles.leg} ${styles[leg.mode] ?? ''} t-micro`}
          style={{ '--m': leg.minutes }}
          aria-hidden="true"
        >
          {leg.mode === 'none' ? (
            <>
              <Icon name="close" size={12} /> 연결 없음
            </>
          ) : (
            `${LEG_MODES[leg.mode]} ${leg.minutes}분`
          )}
        </span>
      ))}
    </div>
  )
}

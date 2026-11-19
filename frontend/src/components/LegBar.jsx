import { hasLightText, modeColor, modeLabel } from '../data/modes.js'
import Icon from './Icon.jsx'
import styles from './LegBar.module.css'

/**
 * 구간 막대 — 이동 수단별 칸이 걸리는 시간에 비례한 너비로 나열됨
 * 색은 수단(mode)에 따라 data/modes.js + tokens.css에서 자동으로 정해짐
 * @param {{mode: string, minutes: number, label?: string}[]} legs label이 없으면 수단 이름 (예: '271번', '2호선')
 */
export default function LegBar({ legs }) {
  const summary = legs
    .map((l) =>
      l.mode === 'none' ? '연결 없음' : `${l.label ?? modeLabel(l.mode)} ${l.minutes}분`,
    )
    .join(', ')

  return (
    <div className={styles.bar} role="img" aria-label={`구간: ${summary}`}>
      {legs.map((leg, i) => (
        <span
          key={i}
          className={[
            styles.leg,
            hasLightText(leg.mode) && styles.lightText,
            leg.mode === 'taxi' && styles.taxi,
            't-micro',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            '--m': leg.minutes,
            '--leg-color': modeColor(leg.mode, 'var(--surface-subtle)'),
          }}
          aria-hidden="true"
        >
          {leg.mode === 'none' ? (
            <>
              <Icon name="close" size={12} /> 연결 없음
            </>
          ) : (
            `${leg.label ?? modeLabel(leg.mode)} ${leg.minutes}분`
          )}
        </span>
      ))}
    </div>
  )
}

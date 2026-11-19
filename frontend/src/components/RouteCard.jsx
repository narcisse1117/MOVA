import { formatFareRange, formatWon } from '../utils/format.js'
import Badge from './Badge.jsx'
import Icon from './Icon.jsx'
import LegBar from './LegBar.jsx'
import styles from './RouteCard.module.css'

/** 명세 F2-02: 택시 직행 대비 절약액과 늦어지는 시간 */
function compareText(option) {
  if (option.kind === 'taxi') return ''
  const parts = []
  if (option.savingVsTaxi > 0) parts.push(`택시 직행보다 약 ${formatWon(option.savingVsTaxi)} 절약`)
  if (option.delayVsTaxiMin > 0) parts.push(`${option.delayVsTaxiMin}분 늦어요`)
  if (option.delayVsTaxiMin < 0) parts.push(`${-option.delayVsTaxiMin}분 빨라요`)
  return parts.join(' · ')
}

/**
 * S2 경로 카드 (조합 / 택시 직행 / 대중교통만, 개수는 서버 응답대로)
 * @param {object} option api/adapt.js의 adaptRoutes 결과 한 건
 * @param {number} index 나타나는 순서 (차례로 등장하는 모션용)
 * @param {() => void} onDetail '자세히' 눌렀을 때
 * @param {() => void} onAlternative 갈 수 없는 안에서 '다른 안 보기' 눌렀을 때
 */
export default function RouteCard({ option, index = 0, onDetail, onAlternative }) {
  const { available } = option
  const compare = compareText(option)

  const cardClass = [
    styles.card,
    option.recommended && available && styles.highlighted,
    !available && styles.unavailable,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClass} style={{ '--i': index }} aria-label={option.badges[0]?.text}>
      <div className={styles.badges}>
        {/* 명세 N-09: 막차 끊김은 색만으로 구분하지 않고 배지 글자로 */}
        {option.badges.map((b) => (
          <Badge key={b.text} tone={b.tone}>
            {b.text}
          </Badge>
        ))}
      </div>

      <p className={`${styles.title} t-label-medium`}>{option.title}</p>

      {available ? (
        <>
          <p className={`${styles.fare} t-fare-m`}>
            {formatFareRange(option.fareMin, option.fareMax)}
          </p>
          {compare && <p className={`${styles.note} ${styles.saving} t-label-medium`}>{compare}</p>}
          <p className={`${styles.meta} t-body-small`}>
            {option.durationMin}분 · {option.arrival} 도착
          </p>

          {/* 지금 출발(live)이면 첫 탈것의 실시간 도착 정보 */}
          {option.realtime?.message && (
            <div className={styles.realtime}>
              <Badge tone="primary">실시간</Badge>
              <p className="t-caption">
                {option.realtime.label} {option.realtime.message}
              </p>
            </div>
          )}

          <LegBar legs={option.bar} />

          {option.tight.map((w) => (
            <div key={w.at} className={styles.warning}>
              <Badge tone="white">주의</Badge>
              <p className="t-caption">{w.message} · 빠듯해요</p>
            </div>
          ))}

          {/* 서버 경고: BUS_ESTIMATE(버스 시각 추정), NO_TRAFFIC(교통 정보 없이 계산) */}
          {option.notices.map((n) => (
            <p key={n.code} className={`${styles.notice} t-caption`}>
              {n.message}
            </p>
          ))}
        </>
      ) : (
        // 대중교통으로 갈 수 없음 (서버 transit-none): 요금·구간 없이 안내만, 카드는 흐리게
        <p className={`${styles.meta} t-body-small`}>{option.message ?? '지금은 갈 수 없어요'}</p>
      )}

      <div className={styles.footer}>
        {available ? (
          <button type="button" className={`${styles.link} t-label-medium`} onClick={onDetail}>
            자세히
            <Icon name="chevron-right" size={16} />
          </button>
        ) : (
          <button type="button" className={`${styles.link} t-label-medium`} onClick={onAlternative}>
            다른 안 보기
          </button>
        )}
      </div>
    </article>
  )
}

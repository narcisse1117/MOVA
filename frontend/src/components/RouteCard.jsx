import { formatFareRange } from '../utils/format.js'
import Badge from './Badge.jsx'
import Icon from './Icon.jsx'
import LegBar from './LegBar.jsx'
import styles from './RouteCard.module.css'

const TIGHT_TRANSFER = 4 // 환승 여유가 이 분 이하면 경고

/**
 * S2 경로 카드 (추천 조합 / 택시 직행 / 대중교통만)
 * @param {object} option data/routes.js의 경로 안
 * @param {boolean} highlighted 맨 위 추천 카드 강조
 * @param {number} index 나타나는 순서 (차례로 등장하는 모션용)
 * @param {() => void} onDetail '자세히' 눌렀을 때
 * @param {() => void} onAlternative 탈 수 없는 안에서 '다른 안 보기' 눌렀을 때
 */
export default function RouteCard({ option, highlighted, index = 0, onDetail, onAlternative }) {
  const { available } = option
  const tight = option.transfer && option.transfer.margin <= TIGHT_TRANSFER

  const cardClass = [
    styles.card,
    highlighted && styles.highlighted,
    !available && styles.unavailable,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClass} style={{ '--i': index }} aria-label={option.badge}>
      <div className={styles.badges}>
        <Badge tone={highlighted ? 'primary' : 'default'}>{option.badge}</Badge>
        {/* 명세 N-09: 막차 끊김은 색만으로 구분하지 않고 배지 + 취소선으로 */}
        {!available && <Badge tone="muted">막차 끊김</Badge>}
      </div>

      <p className={`${styles.title} t-label-medium`}>{option.title}</p>

      <p className={`${styles.fare} t-fare-m`}>
        {available ? (
          formatFareRange(option.fareMin, option.fareMax)
        ) : (
          <del>
            <span className="sr-only">이용 불가, </span>
            {formatFareRange(option.fareMin, option.fareMax)}
          </del>
        )}
      </p>

      {available ? (
        <>
          <p
            className={`${styles.note} ${option.type === 'combo' ? styles.saving : ''} ${
              option.type === 'combo' ? 't-label-medium' : 't-body-small'
            }`}
          >
            {option.note}
          </p>
          <p className={`${styles.meta} t-body-small`}>
            {option.durationMin}분 · {option.arrival} 도착
          </p>
        </>
      ) : (
        <>
          <p className={`${styles.meta} t-body-small`}>{option.unavailableReason}</p>
          <p className={`${styles.meta} t-body-small`}>도착 불가</p>
        </>
      )}

      <LegBar legs={option.legs} />

      {tight && (
        <div className={styles.warning}>
          <Badge tone="white">주의</Badge>
          <p className="t-caption">
            {option.transfer.station} 환승 여유 {option.transfer.margin}분 · 빠듯해요
          </p>
        </div>
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

import Badge from './Badge.jsx'
import Icon from './Icon.jsx'
import LegBar from './LegBar.jsx'
import styles from './BundleCard.module.css'

/**
 * S6 묶음 카드 (와이어프레임 S6)
 * 출발 마감 · 내 묶음 배지 → 제목(수단 · 인원) → 이름들 → 경로 → 구간 막대 → 1인 금액 → 경로 보기
 * @param bundle utils/groupPlan.js buildBundles 결과 한 개
 * @param {() => void} [onRoute] 내 묶음일 때 '경로 보기' (다른 사람 경로는 서버가 주지 않음)
 */
export default function BundleCard({ bundle, onRoute, style }) {
  return (
    <li className={`${styles.card} ${bundle.mine ? styles.mine : ''}`} style={style}>
      <div className={styles.badges}>
        <Badge>{bundle.deadline}</Badge>
        {bundle.mine && <Badge tone="primary">내 묶음</Badge>}
        {bundle.kind === 'taxi' && bundle.estimated && <Badge tone="muted">요금 추정</Badge>}
      </div>

      <p className="t-heading-large">{bundle.title}</p>
      <p className={`${styles.muted} t-body-small`}>{bundle.names}</p>
      {bundle.route && <p className={`${styles.route} t-body-small`}>{bundle.route}</p>}

      {bundle.legs.length > 0 && <LegBar legs={bundle.legs} />}

      {bundle.price && <p className={`${styles.price} t-fare-s`}>{bundle.price}</p>}

      {bundle.warning && <p className={`${styles.muted} t-caption`}>{bundle.warning}</p>}

      {bundle.mine && onRoute && (
        <button type="button" className={`${styles.more} t-label-medium`} onClick={onRoute}>
          경로 보기
          <Icon name="chevron-right" size={14} />
        </button>
      )}
    </li>
  )
}

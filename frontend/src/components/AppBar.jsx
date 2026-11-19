import { Link, useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'
import styles from './AppBar.module.css'

/**
 * WF/AppBar
 * @param {'menu'|'back'} leading 왼쪽 아이콘 종류
 * @param {string} title 가운데 제목
 * @param {{label: string, to?: string, onClick?: () => void}} [action]
 *   오른쪽 텍스트 액션 — to가 있으면 링크, onClick이 있으면 버튼
 * @param {() => void} [onBack] 뒤로 가기 동작 (기본: 브라우저 뒤로)
 * @param {'default'|'canvas'} [tone] 배경색 — 회색 배경 화면(S2 등)에서는 canvas
 */
export default function AppBar({ leading = 'menu', title = 'MOVA', action, onBack, tone = 'default' }) {
  const navigate = useNavigate()

  return (
    <header className={`${styles.bar} ${tone === 'canvas' ? styles.canvas : ''}`}>
      {leading === 'back' ? (
        <button
          type="button"
          className={styles.icon}
          onClick={onBack ?? (() => navigate(-1))}
          aria-label="뒤로 가기"
        >
          <Icon name="chevron-left" size={24} />
        </button>
      ) : (
        <button type="button" className={styles.icon} aria-label="메뉴 열기">
          <Icon name="menu" size={24} />
        </button>
      )}

      <h1 className={`${styles.title} t-nav-title`}>{title}</h1>

      {action?.to && (
        <Link to={action.to} className={`${styles.action} t-nav-action`}>
          {action.label}
        </Link>
      )}
      {action?.onClick && (
        <button
          type="button"
          className={`${styles.action} ${styles.actionButton} t-nav-action`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </header>
  )
}

import { Link, useNavigate } from 'react-router-dom'
import styles from './AppBar.module.css'

/**
 * WF/AppBar
 * @param {'menu'|'back'} leading 왼쪽 아이콘 종류
 * @param {string} title 가운데 제목
 * @param {{label: string, to: string}} [action] 오른쪽 텍스트 링크
 */
export default function AppBar({ leading = 'menu', title = 'MOVA', action }) {
  const navigate = useNavigate()

  return (
    <header className={styles.bar}>
      {leading === 'back' ? (
        <button
          type="button"
          className={styles.icon}
          onClick={() => navigate(-1)}
          aria-label="뒤로 가기"
        >
          ←
        </button>
      ) : (
        <button type="button" className={styles.icon} aria-label="메뉴 열기">
          ≡
        </button>
      )}

      <h1 className={`${styles.title} t-nav-title`}>{title}</h1>

      {action && (
        <Link to={action.to} className={`${styles.action} t-nav-action`}>
          {action.label}
        </Link>
      )}
    </header>
  )
}

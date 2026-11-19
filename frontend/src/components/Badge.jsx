import styles from './Badge.module.css'

/**
 * WF/Badge — onClick을 넘기면 버튼으로 동작
 * @param {'default'|'primary'|'muted'|'white'} [tone]
 *   default: 회색 / primary: 추천 강조 / muted: 막차 끊김 같은 비활성 / white: 회색 박스 안에서
 */
export default function Badge({ children, onClick, tone = 'default', ...rest }) {
  const className = `${styles.badge} ${styles[tone] ?? ''} t-badge`
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <span className={className} {...rest}>
      {children}
    </span>
  )
}

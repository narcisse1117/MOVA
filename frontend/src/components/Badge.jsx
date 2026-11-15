import styles from './Badge.module.css'

/** WF/Badge — onClick을 넘기면 버튼으로 동작 */
export default function Badge({ children, onClick, ...rest }) {
  if (onClick) {
    return (
      <button type="button" className={`${styles.badge} t-badge`} onClick={onClick} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <span className={`${styles.badge} t-badge`} {...rest}>
      {children}
    </span>
  )
}

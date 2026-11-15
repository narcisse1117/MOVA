import styles from './Button.module.css'

/**
 * WF/Button/Primary, WF/Button/Secondary
 * @param {'primary'|'secondary'} variant
 */
export default function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

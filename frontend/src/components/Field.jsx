import { useId } from 'react'
import styles from './Field.module.css'

/**
 * WF/Field — 라벨 + 회색 입력 박스 + 오른쪽 보조 버튼(선택)
 * children에 함수({ id, className })를 넘기면 input 대신 그 요소(select 등)를 박스 안에 그린다.
 */
export default function Field({
  label,
  trailing,
  trailingLabel,
  onTrailingClick,
  children,
  ...inputProps
}) {
  const id = useId()

  return (
    <div className={styles.field}>
      <label htmlFor={id} className="t-label-medium">
        {label}
      </label>
      <div className={styles.box}>
        {children ? (
          children({ id, className: `${styles.input} t-body-large` })
        ) : (
          <input id={id} className={`${styles.input} t-body-large`} {...inputProps} />
        )}
        {trailing && (
          <button
            type="button"
            className={`${styles.trailing} t-body-medium`}
            onClick={onTrailingClick}
            aria-label={trailingLabel}
          >
            {trailing}
          </button>
        )}
      </div>
    </div>
  )
}

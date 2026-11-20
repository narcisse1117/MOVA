import { useEffect, useState } from 'react'
import styles from './ConfirmButton.module.css'

/**
 * 되돌릴 수 없는 동작(빼기·빠지기·모임 끝내기)용 두 번 누르기 버튼
 * 한 번 누르면 confirmLabel로 바뀌고, 4초 안에 다시 누르면 onConfirm
 * @param {'plain'|'danger'} [tone] danger: 흐린 빨간 배경 버튼 (모임 끝내기·빠지기)
 */
export default function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  tone = 'plain',
  className = '',
}) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <button
      type="button"
      className={`${styles.button} ${tone === 'danger' ? styles.danger : ''} ${armed ? styles.armed : ''} t-label-medium ${className}`}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}

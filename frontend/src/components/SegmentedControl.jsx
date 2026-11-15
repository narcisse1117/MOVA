import styles from './SegmentedControl.module.css'

/** S1의 'Time toggle' — 둘 이상의 선택지 중 하나 고르기 */
export default function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={label}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.option} ${selected ? styles.selected : ''} t-body-medium-strong`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

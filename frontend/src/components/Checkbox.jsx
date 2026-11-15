import styles from './Checkbox.module.css'

/** WF/Checkbox */
export default function Checkbox({ label, checked, onChange }) {
  return (
    <label className={styles.checkbox}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.box} aria-hidden="true" />
      <span className="t-body-small">{label}</span>
    </label>
  )
}

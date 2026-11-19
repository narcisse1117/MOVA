import Reveal from './Reveal.jsx'
import styles from './Toast.module.css'

/** 화면 아래에서 올라오는 알림 (공통 모션 slide-up). 상태는 hooks/useToast.js */
export default function Toast({ message }) {
  return (
    <div className={styles.area} aria-live="polite">
      <Reveal show={Boolean(message)} variant="slide-up">
        <p className={`${styles.toast} t-body-medium-strong`}>{message}</p>
      </Reveal>
    </div>
  )
}

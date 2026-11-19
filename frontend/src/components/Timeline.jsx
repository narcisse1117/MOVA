import Badge from './Badge.jsx'
import Icon from './Icon.jsx'
import styles from './Timeline.module.css'

/** 'A → B' 형태의 문구에서 화살표 문자를 아이콘으로 바꿔 표시 */
function withArrows(text) {
  const parts = text.split('→')
  return parts.map((part, i) => (
    <span key={i}>
      {part.trim()}
      {i < parts.length - 1 && <Icon name="arrow-right" size={16} className={styles.arrow} />}
    </span>
  ))
}

/**
 * S3 구간 타임라인
 * @param {{time, title, desc?, action?, warning?, missed?}[]} steps data/routes.js의 buildRouteDetail 결과
 * @param {() => void} onKakao '카카오 T로 부르기' 눌렀을 때
 * @param {() => void} onAlternative '대안 경로 보기' 눌렀을 때
 */
export default function Timeline({ steps, onKakao, onAlternative }) {
  return (
    <ol className={styles.timeline} aria-label="구간 타임라인">
      {steps.map((step, i) => (
        <li key={i} className={styles.step} style={{ '--i': i }}>
          <time className={`${styles.time} t-label-strong`}>{step.time}</time>

          <div className={styles.body}>
            <p className={styles.title}>{withArrows(step.title)}</p>
            {step.desc && <p className={`${styles.desc} t-body-small`}>{step.desc}</p>}

            {step.action === 'kakao' && (
              <button type="button" className={`${styles.chip} t-label-medium`} onClick={onKakao}>
                카카오 T로 부르기
                <Icon name="chevron-right" size={14} />
              </button>
            )}

            {step.warning && (
              <div className={styles.warning}>
                <Badge tone="white">주의</Badge>
                <p className="t-caption">{step.warning}</p>
              </div>
            )}

            {/* 명세: 놓쳤을 때 대안을 각 환승 구간에 표시 */}
            {step.missed && (
              <div className={styles.missed}>
                <p className="t-label-strong">놓쳤을 때</p>
                <p className={`${styles.missedDesc} t-body-small`}>{step.missed.desc}</p>
                <button
                  type="button"
                  className={`${styles.link} t-label-medium`}
                  onClick={onAlternative}
                >
                  대안 경로 보기
                  <Icon name="chevron-right" size={14} />
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

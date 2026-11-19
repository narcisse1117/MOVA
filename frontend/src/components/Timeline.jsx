import { modeColor } from '../data/modes.js'
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
 * @param {{time, title, mode?, desc?, note?, action?, warning?, missed?}[]} steps api/adapt.js의 buildTimeline 결과
 * @param {() => void} onKakao '카카오 T로 부르기' 눌렀을 때
 * @param {() => void} [onAlternative] '대안 경로 보기' 눌렀을 때. 없으면 링크를 숨김
 *   (서버 fallback_taxi에는 요금만 있고 대안 경로가 없어서 지금은 넘기지 않음)
 */
export default function Timeline({ steps, onKakao, onAlternative }) {
  return (
    <ol className={styles.timeline} aria-label="구간 타임라인">
      {steps.map((step, i) => (
        <li key={i} className={styles.step} style={{ '--i': i }}>
          <time className={`${styles.time} t-label-strong`}>{step.time}</time>

          {/* 타고 가는 구간은 세로선을 그 경로의 이동 수단 색으로 (Figma S3) */}
          <div
            className={styles.body}
            style={step.mode ? { '--line-color': modeColor(step.mode) } : undefined}
          >
            <p className={styles.title}>{withArrows(step.title)}</p>
            {step.desc && <p className={`${styles.desc} t-body-small`}>{step.desc}</p>}

            {/* 지금 출발이면 첫 탈것의 실시간 도착 (서버 realtime.message) */}
            {step.note && (
              <div className={styles.note}>
                <Badge tone="primary">실시간</Badge>
                <p className="t-caption">{step.note.replace(/^실시간 · /, '')}</p>
              </div>
            )}

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
                {onAlternative && (
                  <button
                    type="button"
                    className={`${styles.link} t-label-medium`}
                    onClick={onAlternative}
                  >
                    대안 경로 보기
                    <Icon name="chevron-right" size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

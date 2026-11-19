import { useState } from 'react'
import { DURATION, prefersReducedMotion, usePresence } from '../motion/motion.js'
import styles from './Reveal.module.css'

/**
 * 조건에 따라 나타나고 사라지는 요소를 감싸는 공통 컴포넌트.
 * `{조건 && <요소 />}` 대신 `<Reveal show={조건}><요소 /></Reveal>` 로 쓰면
 * 웹 전체에서 같은 속도·곡선으로 부드럽게 나타나고 사라진다.
 *
 * @param {boolean} show 보일지 여부
 * @param {'collapse'|'fade'|'slide-up'|'slide-down'|'scale'} [variant='collapse']
 *   collapse   : 높이가 펼쳐지며 나타남 (아래 요소들도 부드럽게 밀림) — 폼 안의 추가 입력, 안내 문구, 목록
 *   fade       : 제자리에서 투명도만 — 겹쳐 뜨는 요소, 아이콘
 *   slide-up   : 아래에서 살짝 올라오며 — 토스트, 하단 버튼, 바텀시트 내용
 *   slide-down : 위에서 살짝 내려오며 — 드롭다운, 알림 배너
 *   scale      : 살짝 커지며 — 팝업, 배지
 * @param {'fast'|'base'|'slow'} [speed='base']
 * @param {number} [gap=0] 부모가 flex/grid gap을 쓸 때 그 값(px).
 *   collapse에서 닫혀 있는 동안 gap만큼 빈 공간이 남지 않게 맞춰 준다.
 */
export default function Reveal({
  show,
  variant = 'collapse',
  speed = 'base',
  gap = 0,
  className = '',
  children,
}) {
  const duration = prefersReducedMotion() ? 0 : DURATION[speed]
  const { mounted, visible } = usePresence(show, duration)

  // 사라지는 동안에는 마지막으로 보이던 내용을 유지 (예: 오류 문구가 비어도 글자가 먼저 사라지지 않게)
  const [lastChildren, setLastChildren] = useState(children)
  if (show && children !== lastChildren) {
    setLastChildren(children)
  }

  if (!mounted) return null

  const content = show ? children : lastChildren

  return (
    <div
      className={`${styles.reveal} ${styles[variant] ?? ''} ${className}`}
      data-state={visible ? 'open' : 'closed'}
      style={{ '--reveal-duration': `var(--motion-${speed})`, '--reveal-gap': `${gap}px` }}
      inert={!visible}
    >
      {variant === 'collapse' ? <div className={styles.clip}>{content}</div> : content}
    </div>
  )
}

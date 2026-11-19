import { useEffect, useState } from 'react'

// tokens.css의 --motion-* 값과 같게 유지
export const DURATION = {
  fast: 150,
  base: 250,
  slow: 400,
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * 요소가 사라질 때 바로 지우지 않고, 사라지는 모션이 끝난 뒤에 지우기 위한 훅
 *
 * @param {boolean} show 보여야 하는지
 * @param {number} duration 모션 길이(ms)
 * @returns {{ mounted: boolean, visible: boolean }}
 *   mounted: DOM에 남겨 둘지 / visible: 보이는 상태의 스타일을 줄지
 */
export function usePresence(show, duration) {
  const [mounted, setMounted] = useState(show)
  const [entered, setEntered] = useState(show)

  // 다시 보여야 하면 바로 DOM에 올림 (렌더 중 파생 상태 갱신)
  if (show && !mounted) {
    setMounted(true)
  }

  useEffect(() => {
    if (show) {
      // 숨김 상태로 한 번 그려진 다음 프레임에 보이는 상태로 바꿔야 모션이 재생됨
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setEntered(true))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }

    // 사라지는 모션이 끝난 뒤 DOM에서 제거
    const timer = setTimeout(() => {
      setMounted(false)
      setEntered(false)
    }, duration)
    return () => clearTimeout(timer)
  }, [show, duration])

  return { mounted: show || mounted, visible: show && entered }
}

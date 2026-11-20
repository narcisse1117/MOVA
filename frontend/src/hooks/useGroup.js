import { useEffect, useRef, useState } from 'react'
import { getGroup } from '../api/index.js'

// 명세 S6는 10초 갱신이지만, 서버(README)가 모임 조회를 '무거운 요청'으로 보고
// 같은 IP에서 1분 20번·하루 300번만 받는다 → 30초로 늘림 (같은 와이파이의 여러 명을 고려)
const POLL_MS = 30000

/**
 * S6 모임 상태 — GET /api/groups/{id}?leave_at 을 30초마다 다시 부른다
 * - 탭이 안 보이는 동안이나 paused(자동 갱신 끔)일 때는 부르지 않는다
 * - stopAt(모임 출발 시각)이 지나면 자동 갱신을 멈춘다 → 화면의 '새로 고침'으로만
 * - 429(요청 제한)면 서버가 알려 준 retry_after_sec 동안 쉬었다가 다시 부른다
 * - version(참여자가 바뀔 때마다 +1)과 leave_at이 같으면 다시 그리지 않는다 (README)
 * - 갱신이 잠깐 실패해도 마지막 결과는 그대로 보여준다
 *
 * @returns {{group, error, fetchedAt, refresh, autoStopped: boolean, retryAt: number|null}}
 */
export function useGroup(groupId, { token, leaveAt, paused = false, stopAt = null }) {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState({ leaveAt: null, group: null, error: null, fetchedAt: null })
  const [autoStopped, setAutoStopped] = useState(false)
  const [retryAt, setRetryAt] = useState(null)
  const retryRef = useRef(null)

  // 출발 시각이 지나면 자동 갱신 멈춤 (그 순간에 맞춰 한 번만)
  useEffect(() => {
    if (!stopAt) return undefined
    const wait = stopAt - Date.now()
    if (wait <= 0) {
      const t = setTimeout(() => setAutoStopped(true), 0)
      return () => clearTimeout(t)
    }
    const timer = setTimeout(() => setAutoStopped(true), wait)
    return () => clearTimeout(timer)
  }, [stopAt])

  const auto = !paused && !autoStopped

  useEffect(() => {
    let controller = null
    let forced = true // 첫 호출·직접 새로고침은 version이 같아도 반영

    function load() {
      if (document.hidden) return
      if (!forced && retryRef.current && Date.now() < retryRef.current) return
      controller?.abort()
      const current = new AbortController()
      controller = current
      const force = forced
      forced = false
      getGroup(groupId, { token, leaveAt, signal: current.signal })
        .then((group) => {
          retryRef.current = null
          setRetryAt(null)
          setState((prev) =>
            !force &&
            !prev.error &&
            prev.leaveAt === leaveAt &&
            prev.group?.version === group.version
              ? { ...prev, fetchedAt: Date.now() }
              : { leaveAt, group, error: null, fetchedAt: Date.now() },
          )
        })
        .catch((error) => {
          if (current.signal.aborted) return
          if (error?.status === 429) {
            const until = Date.now() + (error.retryAfterSec ?? 60) * 1000
            retryRef.current = until
            setRetryAt(until)
          }
          setState((prev) => ({ ...prev, error }))
        })
    }

    load()
    if (!auto) return () => controller?.abort()
    const timer = setInterval(load, POLL_MS)
    const onVisible = () => !document.hidden && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      controller?.abort()
    }
  }, [groupId, token, leaveAt, auto, tick])

  return {
    group: state.group,
    error: state.error,
    fetchedAt: state.fetchedAt,
    refresh: () => setTick((n) => n + 1),
    autoStopped,
    retryAt,
  }
}

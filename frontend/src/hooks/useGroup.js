import { useEffect, useState } from 'react'
import { getGroup } from '../api/index.js'

const POLL_MS = 10000 // 명세 S6: 10초마다 갱신 (서버 제한: 이 요청은 분당 20번)

/**
 * S6 모임 상태 — GET /api/groups/{id}?leave_at 을 10초마다 다시 부른다
 * - 탭이 안 보이는 동안이나 paused(자동 갱신 끔)일 때는 부르지 않는다
 * - version(참여자가 바뀔 때마다 +1)과 leave_at이 같으면 다시 그리지 않는다 (README)
 * - 갱신이 잠깐 실패해도 마지막 결과는 그대로 보여준다
 *
 * @returns {{group, error, fetchedAt: number|null, refresh: () => void}}
 */
export function useGroup(groupId, { token, leaveAt, paused = false }) {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState({ leaveAt: null, group: null, error: null, fetchedAt: null })

  useEffect(() => {
    let controller = null
    let forced = true // 첫 호출·직접 새로고침은 version이 같아도 반영

    function load() {
      if (document.hidden) return
      controller?.abort()
      const current = new AbortController()
      controller = current
      const force = forced
      forced = false
      getGroup(groupId, { token, leaveAt, signal: current.signal })
        .then((group) =>
          setState((prev) =>
            !force &&
            !prev.error &&
            prev.leaveAt === leaveAt &&
            prev.group?.version === group.version
              ? { ...prev, fetchedAt: Date.now() }
              : { leaveAt, group, error: null, fetchedAt: Date.now() },
          ),
        )
        .catch((error) => {
          if (!current.signal.aborted) setState((prev) => ({ ...prev, error }))
        })
    }

    load()
    if (paused) return () => controller?.abort()
    const timer = setInterval(load, POLL_MS)
    const onVisible = () => !document.hidden && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      controller?.abort()
    }
  }, [groupId, token, leaveAt, paused, tick])

  return {
    group: state.group,
    error: state.error,
    fetchedAt: state.fetchedAt,
    refresh: () => setTick((n) => n + 1),
  }
}

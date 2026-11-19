import { useEffect, useMemo, useState } from 'react'
import { routes, sendEvent } from '../api/index.js'
import { adaptRoutes } from '../api/adapt.js'
import { loadResult, saveResult } from '../utils/storage.js'

const SLOW_MS = 5000 // 이 시간이 지나도 계산 중이면 "조금 걸려요" 안내

/** 같은 검색인지 비교하는 키 (좌표 + 출발 시각) */
export function searchKeyOf(search) {
  return JSON.stringify([
    search.origin.lat,
    search.origin.lng,
    search.destination.lat,
    search.destination.lng,
    search.departure,
  ])
}

/**
 * POST /api/routes 결과 상태
 * - 같은 검색 결과가 이 탭에 있으면 다시 부르지 않음 (S3 ↔ S2 이동, 새로고침)
 * - status: 'loading' | 'ready' | 'error'
 */
export function useRouteSearch(search) {
  const key = search ? searchKeyOf(search) : null
  const [cached] = useState(() => (key ? loadResult(key) : null))
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null) // { attempt, raw } | { attempt, error }
  const [slowFor, setSlowFor] = useState(-1)

  useEffect(() => {
    if (!search || (attempt === 0 && cached)) return undefined
    const controller = new AbortController()
    const slowTimer = setTimeout(() => setSlowFor(attempt), SLOW_MS)

    routes(search, { signal: controller.signal })
      .then((raw) => {
        saveResult(key, raw)
        setResult({ attempt, raw })
        sendEvent('search')
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ attempt, error })
      })
      .finally(() => clearTimeout(slowTimer))

    return () => {
      clearTimeout(slowTimer)
      controller.abort()
    }
    // search는 key로 비교 (같은 검색이면 다시 부르지 않음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, cached])

  const current = result?.attempt === attempt ? result : null
  const raw = current?.raw ?? (attempt === 0 ? cached : null)
  const status = current?.error ? 'error' : raw ? 'ready' : 'loading'
  const data = useMemo(() => (raw ? adaptRoutes(raw) : null), [raw])

  return {
    status,
    data,
    error: current?.error ?? null,
    slow: status === 'loading' && slowFor === attempt,
    retry: () => setAttempt((n) => n + 1),
  }
}

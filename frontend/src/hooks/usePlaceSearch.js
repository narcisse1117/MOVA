import { useEffect, useState } from 'react'
import { geocode } from '../api/index.js'

/**
 * 입력어로 장소 후보 찾기 (GET /api/geocode). 타자 중에는 250ms 기다렸다가 한 번만 부른다.
 * @param {string} query 입력어
 * @param {boolean} enabled 이 칸이 입력 중이고 아직 장소를 고르지 않았을 때만 true
 */
export function usePlaceSearch(query, enabled) {
  const q = query.trim()
  const [result, setResult] = useState({ q: '', results: [], notes: [], error: null })

  useEffect(() => {
    if (!enabled || !q) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      geocode(q, { signal: controller.signal })
        .then((res) =>
          setResult({
            q,
            results: (res.results ?? []).map(toPlace),
            notes: res.notes ?? [],
            error: null,
          }),
        )
        .catch((err) => {
          if (!controller.signal.aborted)
            setResult({ q, results: [], notes: [], error: err.message })
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q, enabled])

  const ready = enabled && Boolean(q) && result.q === q
  return {
    results: ready ? result.results : [],
    notes: ready ? result.notes : [],
    error: ready ? result.error : null,
    loading: enabled && Boolean(q) && result.q !== q,
    searched: ready,
  }
}

/** /api/geocode 결과 한 건 → 화면에서 쓰는 장소 */
export function toPlace(r) {
  return {
    id: `${r.kind}:${r.lat},${r.lng}`,
    kind: r.kind, // station | place | address
    label: r.label,
    name: r.label,
    address: r.address ?? '',
    category: r.category ?? null,
    region: r.region ?? '',
    inSeoul: r.in_seoul,
    lat: r.lat,
    lng: r.lng,
  }
}

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

/** 저장된 집이 입력어와 맞으면 후보 맨 위에 */
export function withHome(results, query, home) {
  const q = query.replace(/\s/g, '')
  if (!home || !q || !home.label.replace(/\s/g, '').includes(q)) return results
  return [{ ...home, id: 'home', isHome: true }, ...results.filter((p) => p.id !== home.sourceId)]
}

/** 자동완성 아래 안내 줄 (명세 오류 처리: 주소를 찾지 못함) */
export function placeStatus(search) {
  if (search.loading) return '찾는 중…'
  if (search.error) return search.error
  if (search.notes.length > 0) return search.notes[0]
  if (search.searched && search.results.length === 0) {
    return '주소를 찾지 못했어요. 역 이름으로도 검색할 수 있어요'
  }
  return ''
}

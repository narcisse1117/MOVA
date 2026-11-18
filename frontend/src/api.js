// MOVA 서버 호출. 주소는 .env의 VITE_API_BASE로 바꿀 수 있다 (예: 로컬 서버 http://127.0.0.1:8000)
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://32.237.22.34.sslip.io'

async function getJson(path, signal) {
  const res = await fetch(API_BASE + path, { signal })
  if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
  return res.json()
}

/** 장소 검색 → [{ id, name, address, region, isSeoul, lat, lng, kind }] */
export async function geocode(query, signal) {
  const data = await getJson(`/api/geocode?q=${encodeURIComponent(query)}`, signal)
  return data.results.map((r) => ({
    id: `${r.kind}:${r.lat},${r.lng}:${r.label}`,
    name: r.label,
    address: r.address,
    region: r.region,
    isSeoul: r.in_seoul,
    lat: r.lat,
    lng: r.lng,
    kind: r.kind,
  }))
}

/** 브라우저 위치 → 장소 하나. 위치 권한이 없거나 실패하면 throw */
export function currentPlace() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치를 알 수 없어요'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = +pos.coords.latitude.toFixed(6)
        const lng = +pos.coords.longitude.toFixed(6)
        try {
          const r = await getJson(`/api/reverse?lat=${lat}&lng=${lng}`)
          resolve({
            id: 'current',
            name: r.label ?? '현재 위치',
            region: r.si ? `${r.si} ${r.gu ?? ''}`.trim() : '',
            isSeoul: r.si ? r.si.startsWith('서울') : false,
            lat,
            lng,
            kind: 'current',
          })
        } catch (e) {
          reject(e)
        }
      },
      () => reject(new Error('위치 권한이 없어요. 출발지를 직접 입력해 주세요')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  })
}

async function postJson(path, body, signal) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (res.status === 429) throw new Error('요청이 너무 많아요. 1분 뒤에 다시 해 주세요')
  if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
  return res.json()
}

const point = (p) => ({ lat: p.lat, lng: p.lng, label: p.name })

/** 경로 검색 (S2). search = { origin, destination, departure: 'now' | 'HH:MM' } */
export function findRoutes(search, signal) {
  return postJson(
    '/api/routes',
    { origin: point(search.origin), destination: point(search.destination), departure_time: search.departure },
    signal,
  )
}

function deviceId() {
  try {
    let id = localStorage.getItem('mova:device')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('mova:device', id)
    }
    return id
  } catch {
    return 'no-storage'
  }
}

/** 사용 기록 (주소 없이). 실패해도 화면은 그대로 */
export function logEvent(name, extra = {}) {
  postJson('/api/events', { device_id: deviceId(), name, ...extra }).catch(() => {})
}

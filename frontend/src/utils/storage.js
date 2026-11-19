// 명세 C-07: 집 주소는 이 브라우저에만 저장. 저장소가 막혀 있어도 화면은 그대로 동작해야 한다.
const HOME_KEY = 'mova:home'
const SEARCH_KEY = 'mova:lastSearch'

export function loadHome() {
  try {
    const raw = localStorage.getItem(HOME_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveHome(place) {
  try {
    const rest = { ...place }
    delete rest.isHome
    localStorage.setItem(
      HOME_KEY,
      JSON.stringify({ ...rest, id: 'home', sourceId: place.sourceId ?? place.id }),
    )
    return true
  } catch {
    return false
  }
}

// 명세: 주소는 URL에 넣지 않음 → 검색 조건은 sessionStorage에 (새로고침 대비)
export function saveSearch(search) {
  try {
    sessionStorage.setItem(SEARCH_KEY, JSON.stringify(search))
  } catch {
    // 저장 실패해도 라우터 state로 전달되므로 무시
  }
}

export function loadSearch() {
  try {
    const raw = sessionStorage.getItem(SEARCH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// 명세: 고른 안을 저장 → S7(도착 후 질문)에서 사용 (localStorage)
const CHOSEN_KEY = 'mova:chosenOption'

export function saveChosenOption(chosen) {
  try {
    localStorage.setItem(CHOSEN_KEY, JSON.stringify({ ...chosen, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function loadChosenOption() {
  try {
    const raw = localStorage.getItem(CHOSEN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// 경로 검색 결과(/api/routes 응답) — S2·S3 새로고침 대비. 서버에 다시 불러오는 API가 없어서 이 탭에만 둔다
const RESULT_KEY = 'mova:lastResult'

export function saveResult(searchKey, response) {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify({ searchKey, response }))
  } catch {
    // 저장 실패해도 화면은 메모리 값으로 동작
  }
}

export function loadResult(searchKey) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RESULT_KEY) ?? 'null')
    return saved?.searchKey === searchKey ? saved.response : null
  } catch {
    return null
  }
}

// 사용 기록(POST /api/events)용 익명 기기 ID — 로그인이 없어서 브라우저에서 만든 임의 값 (명세 C-07, C-08)
const DEVICE_KEY = 'mova:deviceId'

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id =
        crypto.randomUUID?.() ??
        `d_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'd_unknown'
  }
}

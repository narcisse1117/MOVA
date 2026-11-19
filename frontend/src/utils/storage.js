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

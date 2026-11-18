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

// S2 결과를 S3(상세)에서 다시 쓰려고 sessionStorage에 둔다 (주소는 URL에 넣지 않음)
const RESULT_KEY = 'mova:lastResult'

export function saveResult(result) {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(result))
  } catch {
    // 저장 실패 시 S3는 다시 검색하라고 안내
  }
}

export function loadResult() {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// F2-09: 고른 안 (다음에 열면 실제 택시비를 묻는다)
const CHOICE_KEY = 'mova:choice'

export function saveChoice(choice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice))
  } catch {
    // 무시
  }
}

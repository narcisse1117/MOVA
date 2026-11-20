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

/** 좌표까지 있는 저장된 집만 (예전 형식으로 저장된 집은 쓰지 않음). 모임 화면의 집 주소 기본값 */
export function loadHomePlace() {
  const home = loadHome()
  return home && home.lat != null && home.label ? home : null
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
    localStorage.setItem(
      CHOSEN_KEY,
      JSON.stringify({ ...chosen, savedAt: Date.now(), sessionId: getSessionId() }),
    )
    return true
  } catch {
    return false
  }
}

/** S7: 한 검색에 한 번만 묻도록 물어본 시각을 남김 */
export function markChosenAsked() {
  const chosen = loadChosenOption()
  if (!chosen) return
  try {
    localStorage.setItem(CHOSEN_KEY, JSON.stringify({ ...chosen, askedAt: Date.now() }))
  } catch {
    // 저장이 막혀 있으면 이번에만 묻고 끝
  }
}

// 이번 방문(탭)을 구분하는 값 — S7 '다음에 앱을 열면'을 판단할 때 사용
const SESSION_KEY = 'mova:session'

export function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return 's_unknown'
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

// 모임 '내 경로'(S6 → S3) — 주소가 들어 있어 URL 대신 이 탭에만 (새로고침 대비)
const GROUP_ROUTE_KEY = 'mova:groupRoute'

export function saveGroupRoute(payload) {
  try {
    sessionStorage.setItem(GROUP_ROUTE_KEY, JSON.stringify(payload))
  } catch {
    // 저장 실패해도 라우터 state로 전달되므로 무시
  }
}

export function loadGroupRoute() {
  try {
    return JSON.parse(sessionStorage.getItem(GROUP_ROUTE_KEY) ?? 'null')
  } catch {
    return null
  }
}

// 길안내 — '이렇게 갈게요'로 고른 경로를 따라감. 브라우저를 다시 켜도 이어지게 localStorage
const GUIDE_KEY = 'mova:guide'

export function saveGuide(guide) {
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify({ ...guide, startedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function loadGuide() {
  try {
    return JSON.parse(localStorage.getItem(GUIDE_KEY) ?? 'null')
  } catch {
    return null
  }
}

export function updateGuide(patch) {
  const guide = loadGuide()
  if (!guide) return
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify({ ...guide, ...patch }))
  } catch {
    // 저장이 막혀 있으면 이번 화면에서만
  }
}

export function clearGuide() {
  try {
    localStorage.removeItem(GUIDE_KEY)
  } catch {
    // 지울 것도 없음
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

// 모임 토큰 — 관리 토큰(만든 사람)·참여자 토큰을 모임별로 이 브라우저에만 둔다 (README, 명세 F3-03·F3-05)
// 모임이 끝나면 clearGroup으로 지운다
const GROUPS_KEY = 'mova:groups'

function readGroups() {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

/** @returns {{adminToken?, memberId?, memberToken?, nickname?, expiresAt?} | null} */
export function loadGroup(groupId) {
  return readGroups()[groupId] ?? null
}

export function saveGroup(groupId, patch) {
  try {
    const all = readGroups()
    all[groupId] = { ...all[groupId], ...patch }
    localStorage.setItem(GROUPS_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

export function clearGroup(groupId) {
  try {
    const all = readGroups()
    delete all[groupId]
    localStorage.setItem(GROUPS_KEY, JSON.stringify(all))
  } catch {
    // 저장소가 막혀 있으면 지울 것도 없음
  }
}

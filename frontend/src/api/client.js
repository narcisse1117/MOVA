// 서버(server/README.md) 호출 공통 부분
// - VITE_API_BASE: 서버 주소 (예: http://localhost:8000). 비워 두면 예시 데이터(mock)로 동작
// - 서버 CORS는 localhost:5173을 허용해 둠 (config/app.json)

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
export const USE_MOCK = !API_BASE || import.meta.env.VITE_API_MOCK === 'true'

/** 화면에서 그대로 보여줄 수 있는 문장을 가진 오류 */
export class ApiError extends Error {
  constructor(message, { status = 0, retryAfterSec = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

/**
 * @param {string} path '/api/routes' 처럼
 * @param {{method?: string, body?: object, timeoutMs?: number, signal?: AbortSignal}} options
 */
export async function request(path, { method = 'GET', body, timeoutMs = 60000, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort())

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    if (err.name === 'AbortError') {
      throw new ApiError('계산이 너무 오래 걸려요. 다시 시도해 주세요')
    }
    throw new ApiError('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요')
  } finally {
    clearTimeout(timer)
  }

  const data = await res.json().catch(() => null)

  if (res.status === 429) {
    // README: 요청 제한을 넘으면 429 + retry_after_sec
    const retryAfterSec = data?.retry_after_sec ?? null
    throw new ApiError(
      retryAfterSec
        ? `검색이 많아서 잠시 쉬어야 해요. ${Math.ceil(retryAfterSec)}초 뒤에 다시 시도해 주세요`
        : '검색이 많아서 잠시 쉬어야 해요. 조금 뒤에 다시 시도해 주세요',
      { status: 429, retryAfterSec },
    )
  }
  if (!res.ok) {
    throw new ApiError(
      data?.detail && typeof data.detail === 'string'
        ? data.detail
        : '잠시 문제가 생겼어요. 다시 시도해 주세요',
      {
        status: res.status,
      },
    )
  }
  return data
}

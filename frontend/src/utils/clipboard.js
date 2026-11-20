/**
 * 클립보드 복사 — 단톡방 인앱 브라우저처럼 clipboard API가 막힌 곳도 대비 (명세 N-05)
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/**
 * 공유 시트 (없으면 복사). 사용자가 닫으면 아무것도 안 함
 * @returns {Promise<'shared'|'copied'|'failed'|'cancelled'>}
 */
export async function shareOrCopy({ title, text, url }) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url })
      return 'shared'
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'
  }
  return (await copyText(url ? `${text}\n${url}` : text)) ? 'copied' : 'failed'
}

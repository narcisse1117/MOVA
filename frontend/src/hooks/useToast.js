import { useRef, useState } from 'react'

/**
 * 잠깐 떴다 사라지는 알림 문구 상태
 * const [toast, showToast] = useToast()  →  <Toast message={toast} />
 */
export function useToast(duration = 2000) {
  const [message, setMessage] = useState('')
  const timer = useRef(0)

  function show(text) {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), duration)
  }

  return [message, show]
}

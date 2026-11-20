import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getSessionId, loadChosenOption, markChosenAsked } from '../utils/storage.js'
import ArrivalQuestion from './ArrivalQuestion.jsx'
import Reveal from './Reveal.jsx'
import styles from './FeedbackPrompt.module.css'

const HOUR = 3600 * 1000

/**
 * 명세 F2-09: 안을 고르고 다음에 앱을 열면(또는 출발 3시간 뒤까지) 실제 택시비를 묻는다. 한 검색에 한 번만
 * - 택시를 타는 안(택시 직행·조합·모임 택시)을 골랐을 때만
 * - 출발 시각이 지난 뒤에만, 하루가 지나면 묻지 않음
 */
function shouldAsk(chosen, now = Date.now()) {
  if (!chosen || chosen.askedAt || !chosen.hasTaxi || !chosen.departure) return false
  const departure = new Date(chosen.departure).getTime()
  if (now < departure || now - departure > 24 * HOUR) return false
  const nextVisit = chosen.sessionId !== getSessionId()
  return nextVisit || now - departure >= 3 * HOUR
}

/**
 * S7 도착 후 질문 팝업 (와이어프레임 S7: 모바일 바텀시트, 데스크톱 가운데 팝업)
 * 길안내 화면(/guide)에서는 화면 안에서 묻기 때문에 팝업을 띄우지 않는다
 */
export default function FeedbackPrompt() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [chosen, setChosen] = useState(null)
  const [open, setOpen] = useState(true)
  const onGuide = pathname === '/guide'

  useEffect(() => {
    if (onGuide) return undefined
    function check() {
      const c = loadChosenOption()
      if (!shouldAsk(c)) return
      markChosenAsked() // 한 검색에 한 번만
      setChosen(c)
    }
    check()
    const onVisible = () => !document.hidden && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [onGuide])

  if (!chosen) return null

  return (
    <Reveal show={open} variant="fade">
      <div className={styles.backdrop}>
        <section
          className={styles.sheet}
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          <span className={styles.handle} aria-hidden="true" />
          <ArrivalQuestion
            chosen={chosen}
            onClose={() => {
              // 건너뛰기도 팝업을 닫고 메인(S1)으로
              setOpen(false)
              navigate('/')
            }}
            onSubmitted={() => {
              // 택시비를 보낸 뒤에는 팝업을 닫고 메인(S1)으로
              setOpen(false)
              navigate('/')
            }}
          />
        </section>
      </div>
    </Reveal>
  )
}

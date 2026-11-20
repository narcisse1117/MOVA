import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import { clearGroup } from '../utils/storage.js'
import styles from './GroupGoneScreen.module.css'

/**
 * E2 끝났거나 없는 모임 링크 (와이어프레임 E2)
 * /g/:groupId 조회 결과가 만료·없음일 때. 남아 있는 관리·참여자 토큰은 이때 지운다
 * 와이어프레임 문구의 '참여 마감'은 서버에 없어서 '모임이 끝났거나'로 바꿈
 */
export default function GroupGoneScreen({ groupId }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (groupId) clearGroup(groupId)
  }, [groupId])

  return (
    <div className={styles.page}>
      <AppBar leading="menu" title="MOVA" wide />
      <div className={`page-body ${styles.layout}`} data-layout="wide">
        <div className={styles.card}>
          <div className={styles.icon} aria-hidden="true">
            !
          </div>
          <h2 className="t-title-medium">끝났거나 없는 모임이에요</h2>
          <p className={`${styles.desc} t-body-small`}>
            모임이 끝났거나 링크가 잘못되었어요.
            <br />
            모임을 만든 사람에게 새 링크를 받아 주세요.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => navigate('/group/new')}>새 모임 만들기</Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              혼자 경로 찾기
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

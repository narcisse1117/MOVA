import { useLocation, useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import styles from './StatusPage.module.css'

/** E1 서울 밖 주소 안내 — 문구는 명세상 아직 확정 전 */
export default function OutOfAreaPage() {
  const navigate = useNavigate()
  const { state } = useLocation()

  return (
    <>
      <AppBar leading="back" title="MOVA" />
      <div className="page-body">
        <div className={styles.message}>
          <div className={styles.icon} aria-hidden="true">
            !
          </div>
          <h2 className="t-title-large">
            아직 서울 안에서만
            <br />
            경로를 찾을 수 있어요
          </h2>
          <p className={`${styles.desc} t-body-small`}>
            {state?.address && (
              <>
                입력한 주소: {state.address}
                <br />
              </>
            )}
            출발지와 도착지가 모두 서울이어야 해요
          </p>
        </div>
        <Button onClick={() => navigate('/')}>주소 다시 입력하기</Button>
      </div>
    </>
  )
}

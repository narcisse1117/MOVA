import { Link } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import styles from './StatusPage.module.css'

/** 아직 구현하지 않은 화면 자리 */
export default function PlaceholderPage({ title, code }) {
  return (
    <>
      <AppBar leading="back" title={title} />
      <div className="page-body">
        <div className={styles.message}>
          <h2 className="t-title-large">{code} 화면 준비 중</h2>
          <p className={`${styles.desc} t-body-small`}>
            Figma 와이어프레임을 보고 다음 단계에서 구현할 예정이에요.
          </p>
          <Link to="/" className="t-nav-action">
            처음으로
          </Link>
        </div>
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getGroup, joinGroup, sendEvent } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import Field from '../components/Field.jsx'
import Icon from '../components/Icon.jsx'
import PlaceField from '../components/PlaceField.jsx'
import Reveal from '../components/Reveal.jsx'
import { formatDateTime } from '../utils/format.js'
import { loadGroup, loadHomePlace, saveGroup } from '../utils/storage.js'
import styles from './GroupJoinPage.module.css'
import statusStyles from './StatusPage.module.css'

const emptyPoint = { text: '', place: null }

/** 404(없음)·410(끝남)·status 'expired'는 모두 '끝났거나 없는 모임' 화면 */
const isGone = (err) => err?.status === 404 || err?.status === 410

/**
 * S5 모임 참여 /g/:groupId (아직 참여하지 않은 기기)
 * 1) GET /api/groups/{id} → 모임 이름, 출발 장소, 출발 예정 시각
 * 2) 닉네임 + 집 주소 → POST /api/groups/{id}/members → member_token 저장 → S6
 */
export default function GroupJoinPage({ groupId, onJoined }) {
  const navigate = useNavigate()
  const [saved] = useState(() => loadGroup(groupId))
  const [home] = useState(loadHomePlace)

  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(null) // { attempt, group } | { attempt, error }

  const [nickname, setNickname] = useState('')
  const [myHome, setMyHome] = useState(() =>
    home ? { text: home.label, place: home } : emptyPoint,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false) // 참여 중에 410을 받은 경우

  useEffect(() => {
    const controller = new AbortController()
    // 만든 사람이 자기 참여에 실패했던 기기면 관리 토큰으로 불러 is_admin을 받는다
    getGroup(groupId, { token: saved?.adminToken, signal: controller.signal })
      .then((group) => setLoaded({ attempt, group }))
      .catch((err) => {
        if (!controller.signal.aborted) setLoaded({ attempt, error: err })
      })
    return () => controller.abort()
  }, [groupId, attempt, saved])

  const current = loaded?.attempt === attempt ? loaded : null
  const group = current?.group
  const loadError = current?.error

  if (gone || isGone(loadError) || group?.status === 'expired') {
    return <GoneScreen onHome={() => navigate('/')} onNew={() => navigate('/group/new')} />
  }

  function validate() {
    if (!nickname.trim()) return '닉네임을 넣어 주세요'
    if (!myHome.place) return '집 주소를 목록에서 골라 주세요'
    if (myHome.place.inSeoul === false) {
      return `아직 서울 안만 지원해요 (${myHome.place.region} ${myHome.place.label})`
    }
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const me = await joinGroup(groupId, { nickname: nickname.trim(), home: myHome.place })
      saveGroup(groupId, {
        memberId: me.id,
        memberToken: me.member_token,
        nickname: me.nickname,
        expiresAt: group.expires_at,
      })
      sendEvent('group_join')
      onJoined(me)
    } catch (err) {
      if (isGone(err)) setGone(true)
      else setError(err.message)
      setSubmitting(false)
    }
  }

  const memberCount = group?.members?.length ?? 0

  return (
    <>
      <AppBar
        leading="back"
        title="모임 참여"
        wide
        className={styles.appBar}
        onBack={() => navigate('/')}
      />

      {/* data-layout="wide": 데스크톱에서 넓은 레이아웃 사용 (index.css) */}
      <form
        className={`page-body ${styles.layout}`}
        data-layout="wide"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className={styles.panel}>
          {/* 모임 정보 (서버 GET /api/groups/{id}) */}
          {loadError ? (
            <section className={styles.error} role="alert">
              <p className="t-heading-medium">모임 정보를 불러오지 못했어요</p>
              <p className={`${styles.muted} t-body-small`}>{loadError.message}</p>
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                다시 불러오기
              </Button>
            </section>
          ) : !group ? (
            <section
              className={styles.skeleton}
              aria-busy="true"
              aria-label="모임 정보 불러오는 중"
            >
              <span />
              <span />
              <span />
            </section>
          ) : (
            <section className={styles.group} aria-label="모임 정보">
              <p className={`${styles.muted} t-label-medium`}>모임에 초대받았어요</p>
              <h2 className="t-title-large">{group.name || '이름 없는 모임'}</h2>
              <dl className={styles.facts}>
                <div>
                  <dt className={`${styles.muted} t-label-medium`}>출발 장소</dt>
                  <dd className="t-body-medium-strong">{group.meeting_place?.label}</dd>
                </div>
                <div>
                  <dt className={`${styles.muted} t-label-medium`}>출발 예정</dt>
                  <dd className="t-body-medium-strong">{formatDateTime(group.departure)}</dd>
                </div>
              </dl>
              {memberCount > 0 && (
                <p className={`${styles.members} t-caption`}>
                  {group.members.map((m) => m.nickname).join(', ')} · {memberCount}명 참여 중
                </p>
              )}
            </section>
          )}

          <fieldset className={styles.fields} disabled={!group || submitting}>
            <legend className="sr-only">참여 정보</legend>

            <Field
              label="내 닉네임"
              placeholder="모임에서 보일 이름"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
            />

            <PlaceField
              label="내 집 주소"
              placeholder="집 주소나 가까운 역"
              value={myHome}
              onChange={setMyHome}
              home={home}
              gap={16}
            />
          </fieldset>

          {/* 명세 S5 주소 저장 안내 (서버 README: 다른 사람에게는 area만, 24시간 뒤 자동 삭제) */}
          <div className={styles.privacy}>
            <Icon name="locate" size={18} className={styles.privacyIcon} />
            <p className="t-caption">
              다른 사람에게는 동 이름과 가까운 역까지만 보여요.
              <br />집 주소는 모임을 만든 지 24시간 뒤 지워져요
              {group?.expires_at && ` (${formatDateTime(group.expires_at)})`}
            </p>
          </div>

          <Reveal show={Boolean(error)} gap={16}>
            <p className={`${styles.formError} t-body-small`} role="alert">
              {error}
            </p>
          </Reveal>

          <Button type="submit" disabled={!group || submitting}>
            {submitting ? '참여하는 중…' : '참여하기'}
          </Button>
        </div>
      </form>
    </>
  )
}

/** E2 끝났거나 없는 모임 (명세: 지원 안 되는 모임 링크 안내 화면) */
function GoneScreen({ onHome, onNew }) {
  return (
    <>
      <AppBar leading="back" title="모임 참여" onBack={onHome} />
      <div className="page-body">
        <div className={statusStyles.message}>
          <div className={statusStyles.icon} aria-hidden="true">
            !
          </div>
          <h2 className="t-title-large">
            끝났거나
            <br />
            없는 모임이에요
          </h2>
          <p className={`${statusStyles.desc} t-body-small`}>
            모임은 만든 지 24시간이 지나면 주소와 함께 지워져요.
            <br />
            링크를 보낸 사람에게 새 링크를 받아 주세요
          </p>
        </div>
        <Button onClick={onNew}>새 모임 만들기</Button>
        <Button variant="secondary" onClick={onHome}>
          처음으로
        </Button>
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getGroup, joinGroup, sendEvent } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import Checkbox from '../components/Checkbox.jsx'
import Field from '../components/Field.jsx'
import PlaceField from '../components/PlaceField.jsx'
import Reveal from '../components/Reveal.jsx'
import { loadGroup, loadHomePlace, saveGroup, saveHome } from '../utils/storage.js'
import { hhmmOf } from '../utils/time.js'
import GroupGoneScreen from './GroupGoneScreen.jsx'
import styles from './GroupJoinPage.module.css'

const emptyPoint = { text: '', place: null }

/** 404(없음)·410(끝남)·status 'expired'는 모두 E2 '끝났거나 없는 모임' 화면 */
const isGone = (err) => err?.status === 404 || err?.status === 410

/**
 * S5 모임 참여 /g/:groupId (와이어프레임 S5, 아직 참여하지 않은 기기)
 * 1) GET /api/groups/{id} → 모임 이름, 출발 장소·시각, 참여자
 * 2) 내 이름 + 내 도착지 → POST /api/groups/{id}/members → member_token 저장 → S6
 *
 * 와이어프레임에 있지만 서버(README)에 없어 뺀 것: 참여 마감 시각 · 남은 시간
 */
export default function GroupJoinPage({ groupId, onJoined, notice }) {
  const navigate = useNavigate()
  const [saved] = useState(() => loadGroup(groupId))
  const [home] = useState(loadHomePlace)

  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(null) // { attempt, group } | { attempt, error }

  const [nickname, setNickname] = useState('')
  const [myHome, setMyHome] = useState(() =>
    home ? { text: home.label, place: home } : emptyPoint,
  )
  const [saveAsHome, setSaveAsHome] = useState(false)
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
    return <GroupGoneScreen groupId={groupId} />
  }

  function validate() {
    if (!nickname.trim()) return '이름을 넣어 주세요'
    if (!myHome.place) return '도착지를 목록에서 골라 주세요'
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
      // 와이어프레임 S5: 이 도착지를 집 주소로 저장 (이 기기에만)
      if (saveAsHome) saveHome(myHome.place)
      sendEvent('group_join')
      onJoined(me)
    } catch (err) {
      if (isGone(err)) setGone(true)
      else setError(err.message)
      setSubmitting(false)
    }
  }

  const members = group?.members ?? []

  return (
    <div className={styles.page}>
      <AppBar
        leading="back"
        title="모임 참여"
        wide
        className={styles.appBar}
        onBack={() => navigate('/')}
      />

      {/* data-layout="wide": 데스크톱에서 넓은 레이아웃 사용 (index.css) */}
      <div className={`page-body ${styles.layout}`} data-layout="wide">
        {/* 데스크톱에서만 보이는 큰 제목 (와이어프레임 데스크톱 S5) */}
        <h2 className={`${styles.heading} t-title-large`}>모임 참여</h2>

        {/* S6에서 빠졌거나 만든 사람이 뺐을 때 */}
        {notice && (
          <p className={`${styles.notice} t-body-small`} role="status">
            {notice}
          </p>
        )}

        {/* 모임 정보 카드 (서버 GET /api/groups/{id}) */}
        {loadError ? (
          <section className={styles.info} role="alert">
            <p className="t-heading-medium">모임 정보를 불러오지 못했어요</p>
            <p className={`${styles.muted} t-body-small`}>{loadError.message}</p>
            <Button
              variant="secondary"
              className={styles.raised}
              onClick={() => setAttempt((n) => n + 1)}
            >
              다시 불러오기
            </Button>
          </section>
        ) : !group ? (
          <section className={`${styles.info} ${styles.skeleton}`} aria-busy="true">
            <span />
            <span />
            <span />
          </section>
        ) : (
          <section className={styles.info} aria-label="모임 정보">
            <p className="t-caption-strong">참여 {members.length}명</p>
            <p className="t-title-medium">{group.name || '모임'}</p>
            <p className={`${styles.muted} t-body-small`}>
              {group.meeting_place?.label} · {hhmmOf(group.departure)} 출발
            </p>
            {members.length > 0 && (
              <ul className={styles.chips} aria-label="참여한 사람">
                {members.map((m) => (
                  <li key={m.id} className="t-caption-medium">
                    {m.nickname}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <fieldset className={styles.fields} disabled={!group || submitting}>
            <legend className="sr-only">참여 정보</legend>

            <Field
              label="내 이름"
              placeholder="이름을 입력하세요"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
            />

            <PlaceField
              label="내 도착지"
              placeholder="도착지 검색"
              value={myHome}
              onChange={setMyHome}
              home={home}
              gap={16}
            />

            {/* 서버 README: 다른 사람에게는 동·가까운 역만, 모임이 끝나면(최대 24시간) 주소 삭제 */}
            <p className={`${styles.muted} t-caption`}>
              도착지는 경로 묶기와 정산에만 쓰고, 모임이 끝나면 지워요
            </p>

            <Checkbox
              label="이 도착지를 집 주소로 저장 (이 기기에만)"
              checked={saveAsHome}
              onChange={setSaveAsHome}
            />
          </fieldset>

          <Reveal show={Boolean(error)} gap={16}>
            <p className={`${styles.formError} t-body-small`} role="alert">
              {error}
            </p>
          </Reveal>

          <Button type="submit" disabled={!group || submitting}>
            {submitting ? '참여하는 중…' : '참여하기'}
          </Button>
        </form>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createGroup, joinGroup, sendEvent } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import Button from '../components/Button.jsx'
import Field from '../components/Field.jsx'
import Icon from '../components/Icon.jsx'
import PlaceField from '../components/PlaceField.jsx'
import Reveal from '../components/Reveal.jsx'
import Toast from '../components/Toast.jsx'
import { useToast } from '../hooks/useToast.js'
import { copyText, shareOrCopy } from '../utils/clipboard.js'
import { loadHomePlace, saveGroup } from '../utils/storage.js'
import { DEPARTURE_OPTIONS } from '../utils/time.js'
import styles from './GroupNewPage.module.css'

const emptyPoint = { text: '', place: null }

/**
 * S4 모임 만들기 /group/new (와이어프레임 S4)
 * 1) POST /api/groups → id, share_path, admin_token(이 브라우저에만 저장)
 * 2) 만든 사람도 참여자로 POST /api/groups/{id}/members → member_token 저장
 * 3) 링크 복사·공유 → 모임 화면(S6)
 *
 * 와이어프레임에 있지만 서버(README)에 없어 뺀 것: 참여 마감
 * 모임 이름 칸은 와이어프레임에 없어서, 이름은 'OO님의 모임'으로 자동으로 붙인다 (S5 제목)
 */
export default function GroupNewPage() {
  const navigate = useNavigate()
  const [home] = useState(loadHomePlace)
  const [toast, showToast] = useToast()

  const [meeting, setMeeting] = useState(emptyPoint)
  const [departure, setDeparture] = useState('now')
  const [nickname, setNickname] = useState('')
  // 저장한 집 주소가 있으면 내 도착지 기본값 (명세 C-07)
  const [myHome, setMyHome] = useState(() =>
    home ? { text: home.label, place: home } : emptyPoint,
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null) // { id, sharePath, name }

  const shareUrl = created ? `${window.location.origin}${created.sharePath}` : ''

  function validate() {
    if (!meeting.place) return '모임 장소를 목록에서 골라 주세요'
    if (!nickname.trim()) return '내 이름을 넣어 주세요'
    if (!myHome.place) return '내 도착지를 목록에서 골라 주세요'
    // 명세 C-06 + 서버 in_seoul: 서울 밖은 계산하지 않음
    const outside = [meeting.place, myHome.place].find((p) => p.inSeoul === false)
    if (outside) return `아직 서울 안만 지원해요 (${outside.region} ${outside.label})`
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

    const name = `${nickname.trim()}님의 모임`
    let group
    try {
      group = await createGroup({ name, meetingPlace: meeting.place, departure })
      // admin_token은 다시 받을 수 없어서 바로 저장
      saveGroup(group.id, { adminToken: group.admin_token, expiresAt: group.expires_at })
      sendEvent('group_create')
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
      return
    }

    // 만든 사람도 참여자로 넣기. 실패해도 모임과 링크는 살아 있으니 링크는 보여 준다
    try {
      const me = await joinGroup(group.id, { nickname: nickname.trim(), home: myHome.place })
      saveGroup(group.id, { memberId: me.id, memberToken: me.member_token, nickname: me.nickname })
    } catch (err) {
      setError(
        `모임은 만들었지만 내 정보를 넣지 못했어요. 모임 화면에서 다시 넣어 주세요 (${err.message})`,
      )
    }

    setCreated({ id: group.id, sharePath: group.share_path, name })
    setSubmitting(false)
  }

  async function handleCopy() {
    showToast((await copyText(shareUrl)) ? '링크를 복사했어요' : '링크를 길게 눌러 복사해 주세요')
  }

  // '카톡으로 공유': 휴대폰 공유 창(카카오톡 포함)을 연다. 공유 창이 없으면 복사
  // (카카오톡 공유 SDK는 앱 키가 있어야 해서 쓰지 않음)
  async function handleShare() {
    const result = await shareOrCopy({
      title: created.name,
      text: `${created.name} · 도착지만 넣으면 같이 탈 택시와 막차를 알려줘요`,
      url: shareUrl,
    })
    if (result === 'copied') showToast('링크를 복사했어요. 카톡에 붙여 넣어 주세요')
    if (result === 'failed') showToast('링크를 길게 눌러 복사해 주세요')
  }

  return (
    <>
      <AppBar
        leading="back"
        title="모임 만들기"
        wide
        className={styles.appBar}
        onBack={() => navigate('/')}
      />

      {/* data-layout="wide": 데스크톱에서 넓은 레이아웃 사용 (index.css) */}
      <div className={`page-body ${styles.layout}`} data-layout="wide">
        <h2 className={`${styles.intro} t-title-large`}>
          같이 가는 사람들의 경로를
          <br />한 번에 묶어 드려요
        </h2>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <fieldset className={styles.fields} disabled={Boolean(created) || submitting}>
            <legend className="sr-only">모임 정보</legend>

            <PlaceField
              label="모임 장소 (출발지)"
              placeholder="모이는 곳 (역·가게·주소)"
              value={meeting}
              onChange={setMeeting}
              gap={16}
              locatable
              onError={setError}
            />

            <Field label="출발 시각">
              {({ id, className }) => (
                <>
                  <select
                    id={id}
                    className={className}
                    value={departure}
                    onChange={(e) => setDeparture(e.target.value)}
                  >
                    <option value="now">지금</option>
                    {DEPARTURE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron-down" size={20} className={styles.caret} />
                </>
              )}
            </Field>

            <Field
              label="내 이름"
              placeholder="모임에서 보일 이름"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
            />

            <PlaceField
              label="내 도착지"
              placeholder="집 주소나 가까운 역"
              value={myHome}
              onChange={setMyHome}
              home={home}
              gap={16}
            />
          </fieldset>

          <Reveal show={Boolean(error)} gap={16}>
            <p className={`${styles.error} t-body-small`} role="alert">
              {error}
            </p>
          </Reveal>

          {created ? (
            <Button onClick={() => navigate(created.sharePath)}>모임 화면으로 가기</Button>
          ) : (
            <Button type="submit" disabled={submitting}>
              {submitting ? '만드는 중…' : '모임 링크 만들기'}
            </Button>
          )}
        </form>

        {/* 링크 생성 후 (와이어프레임 S4 아래 카드 / 데스크톱 오른쪽) */}
        <div className={styles.side}>
          <Reveal show={Boolean(created)} gap={16}>
            <section className={styles.created} aria-label="모임 링크">
              <p className="t-heading-medium">링크가 만들어졌어요</p>
              <p className={`${styles.link} t-body-small`}>{shareUrl}</p>
              <div className={styles.linkActions}>
                <button type="button" className="t-body-medium-strong" onClick={handleCopy}>
                  링크 복사
                </button>
                <button type="button" className="t-body-medium-strong" onClick={handleShare}>
                  카톡으로 공유
                </button>
              </div>
            </section>
          </Reveal>
        </div>
      </div>

      <Toast message={toast} />
    </>
  )
}

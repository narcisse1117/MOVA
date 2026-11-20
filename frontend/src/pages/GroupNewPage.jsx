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
import { formatDateTime } from '../utils/format.js'
import { loadHomePlace, saveGroup } from '../utils/storage.js'
import { DEPARTURE_OPTIONS } from '../utils/time.js'
import styles from './GroupNewPage.module.css'

const emptyPoint = { text: '', place: null }

/**
 * 클립보드 복사 — 단톡방 인앱 브라우저처럼 clipboard API가 막힌 곳도 대비 (명세 N-05)
 * @returns {Promise<boolean>}
 */
async function copyText(text) {
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
 * S4 모임 만들기 /group/new
 * 1) POST /api/groups → id, share_path, admin_token(이 브라우저에만 저장)
 * 2) 만든 사람도 참여자로 POST /api/groups/{id}/members → member_token 저장
 * 3) 링크 복사·공유 → 모임 화면(S6)
 *
 * 서버(README)에 없는 명세 항목은 넣지 않음: 인원 제한(8명), 참여 마감 시각
 */
export default function GroupNewPage() {
  const navigate = useNavigate()
  const [home] = useState(loadHomePlace)
  const [toast, showToast] = useToast()

  const [name, setName] = useState('')
  const [meeting, setMeeting] = useState(emptyPoint)
  const [departure, setDeparture] = useState('now')
  const [nickname, setNickname] = useState('')
  // 명세 C-07: 저장한 집 주소가 있으면 기본값
  const [myHome, setMyHome] = useState(() =>
    home ? { text: home.label, place: home } : emptyPoint,
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null) // { id, url, sharePath, expiresAt, nickname, area }

  const shareUrl = created ? `${window.location.origin}${created.sharePath}` : ''

  function validate() {
    if (!meeting.place) return '출발 장소를 목록에서 골라 주세요'
    if (!nickname.trim()) return '내 닉네임을 넣어 주세요'
    if (!myHome.place) return '집 주소를 목록에서 골라 주세요'
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

    let group
    try {
      group = await createGroup({ name: name.trim(), meetingPlace: meeting.place, departure })
      // admin_token은 다시 받을 수 없어서 바로 저장
      saveGroup(group.id, { adminToken: group.admin_token, expiresAt: group.expires_at })
      sendEvent('group_create')
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
      return
    }

    // 만든 사람도 참여자로 넣기. 실패해도 모임과 링크는 살아 있으니 링크는 보여 준다
    let me = null
    try {
      me = await joinGroup(group.id, { nickname: nickname.trim(), home: myHome.place })
      saveGroup(group.id, { memberId: me.id, memberToken: me.member_token, nickname: me.nickname })
    } catch (err) {
      setError(
        `모임은 만들었지만 내 정보를 넣지 못했어요. 모임 화면에서 다시 넣어 주세요 (${err.message})`,
      )
    }

    setCreated({
      id: group.id,
      sharePath: group.share_path,
      departure: group.departure,
      expiresAt: group.expires_at,
      nickname: me?.nickname ?? null,
      area: me?.area ?? null,
    })
    setSubmitting(false)
  }

  async function handleCopy() {
    showToast((await copyText(shareUrl)) ? '링크를 복사했어요' : '링크를 길게 눌러 복사해 주세요')
  }

  async function handleShare() {
    const title = name.trim() || '모임'
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${title} 귀갓길 같이 정해요`,
          text: `${title} · 집 주소만 넣으면 같이 탈 택시와 막차를 알려줘요`,
          url: shareUrl,
        })
        return
      }
      await handleCopy()
    } catch (err) {
      if (err?.name !== 'AbortError') await handleCopy()
    }
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
      <form
        className={`page-body ${styles.layout}`}
        data-layout="wide"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className={styles.panel}>
          <h2 className={`${styles.intro} t-title-large`}>
            같이 가는 사람들의 경로를
            <br />한 번에 묶어 드려요
          </h2>

          <fieldset className={styles.fields} disabled={Boolean(created) || submitting}>
            <legend className="sr-only">모임 정보</legend>

            <Field
              label="모임 이름 (선택)"
              placeholder="예: 팀 송년회"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
            />

            <PlaceField
              label="출발 장소"
              placeholder="모이는 곳 (역·가게·주소)"
              value={meeting}
              onChange={setMeeting}
              gap={16}
            />

            <Field label="출발 예정 시각">
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

            {/* 서버 README: 다른 사람에게는 동 이름·가까운 역만, 24시간 뒤 주소 자동 삭제 */}
            <p className={`${styles.help} t-caption`}>
              다른 사람에게는 동 이름과 가까운 역까지만 보여요. 주소는 24시간 뒤 지워져요
            </p>
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
              {submitting ? '만드는 중…' : '모임 만들기'}
            </Button>
          )}

          {/* 링크 생성 후 (Figma S4 'State · 링크 생성 후') */}
          <Reveal show={Boolean(created)} gap={16}>
            <section className={styles.created} aria-label="모임 링크">
              <p className="t-heading-medium">링크가 만들어졌어요</p>
              <p className={`${styles.link} t-body-medium`}>{shareUrl}</p>
              <div className={styles.linkActions}>
                <Button variant="secondary" onClick={handleCopy}>
                  링크 복사
                </Button>
                <Button variant="secondary" onClick={handleShare}>
                  공유하기
                </Button>
              </div>
              <p className={`${styles.help} t-caption`}>
                {created?.departure && `${formatDateTime(created.departure)} 출발 기준 · `}
                {created?.expiresAt &&
                  `${formatDateTime(created.expiresAt)}에 주소와 함께 지워져요`}
              </p>
            </section>
          </Reveal>
        </div>
      </form>

      <Toast message={toast} />
    </>
  )
}

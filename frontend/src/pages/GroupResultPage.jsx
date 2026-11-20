import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { endGroup, joinGroup, removeMember, updateMember } from '../api/index.js'
import AppBar from '../components/AppBar.jsx'
import BundleCard from '../components/BundleCard.jsx'
import Button from '../components/Button.jsx'
import MemberManager from '../components/MemberManager.jsx'
import SettlementSection from '../components/SettlementSection.jsx'
import Toast from '../components/Toast.jsx'
import { useGroup } from '../hooks/useGroup.js'
import { useToast } from '../hooks/useToast.js'
import { copyText, shareOrCopy } from '../utils/clipboard.js'
import { buildBundles, buildTransfers } from '../utils/groupPlan.js'
import { loadGroup, saveGroup, saveSearch } from '../utils/storage.js'
import { seoulLocal } from '../utils/time.js'
import GroupGoneScreen from './GroupGoneScreen.jsx'
import styles from './GroupResultPage.module.css'

const isGone = (err) => err?.status === 404 || err?.status === 410
const clock = (ms) =>
  new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

/** 서버 좌표 {lat, lng, label} → S1·S2가 쓰는 장소 모양 */
const toPlace = (p, id) => ({
  id,
  kind: 'place',
  label: p.label,
  name: p.label,
  lat: p.lat,
  lng: p.lng,
  inSeoul: true,
})

/**
 * S6 모임 결과 /g/:groupId (와이어프레임 S6 · S6-b, 이 기기가 참여한 모임)
 * - 요약(참여 인원 · 갱신 시각 · 공유) → 묶음 카드(출발 마감 빠른 순) → 정산 → 참여자
 * - leave_at은 모임 출발 시각(S4 '출발 시각'). 이 시각에 막차가 끊긴 사람끼리 서버가 택시로 묶는다
 * - 10초마다 갱신, 앱 바 '자동 갱신'으로 끄고 켬
 *
 * 와이어프레임에 있지만 서버(README)에 없어 뺀 것: 참여 마감 시각, 토스·카카오페이 송금 버튼,
 * 대중교통으로 가는 사람끼리 묶은 카드(서버는 택시만 묶음 → 각자 카드로 보여줌)
 */
export default function GroupResultPage({ groupId, onLeft, onGone }) {
  const navigate = useNavigate()
  const [saved] = useState(() => loadGroup(groupId) ?? {})
  const adminToken = saved.adminToken ?? null
  const [toast, showToast] = useToast(2400)
  const [auto, setAuto] = useState(true)

  // 첫 응답의 출발 시각을 leave_at으로 다시 불러 택시 묶음·정산까지 받는다
  const [departure, setDeparture] = useState(null)
  const leaveAt = departure ? seoulLocal(new Date(departure).getTime()) : undefined
  const { group, error, fetchedAt, refresh } = useGroup(groupId, {
    token: saved.memberToken,
    leaveAt,
    paused: !auto,
  })
  if (group?.departure && group.departure !== departure) setDeparture(group.departure)

  const [busy, setBusy] = useState(false)

  // 만든 사람이 나를 뺐으면(내 member_id가 목록에 없음) 참여 화면(S5)으로
  const removed =
    Boolean(group) && Boolean(saved.memberId) && !group.members.some((m) => m.id === saved.memberId)
  useEffect(() => {
    if (!removed) return
    saveGroup(groupId, { memberId: null, memberToken: null, nickname: null })
    onLeft?.('모임에서 빠졌어요. 다시 참여할 수 있어요')
  }, [removed, groupId, onLeft])

  if (isGone(error) || group?.status === 'expired') return <GroupGoneScreen groupId={groupId} />

  const ready = Boolean(group && leaveAt && group.taxi_groups)
  const me = group?.members.find((m) => m.is_me)
  const bundles = ready ? buildBundles(group, leaveAt) : []
  const transfers = ready ? buildTransfers(group) : []

  async function run(action, success) {
    setBusy(true)
    try {
      await action()
      if (success) showToast(success)
      refresh()
      return true
    } catch (err) {
      if (isGone(err)) onGone?.()
      showToast(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    const name = group?.name || '모임'
    const result = await shareOrCopy({
      title: name,
      text: `${name} · 도착지만 넣으면 같이 탈 택시와 막차를 알려줘요`,
      url: `${window.location.origin}/g/${groupId}`,
    })
    if (result === 'copied') showToast('링크를 복사했어요')
    if (result === 'failed') showToast('링크를 복사하지 못했어요')
  }

  async function handleCopy(text, message) {
    showToast((await copyText(text)) ? message : '복사하지 못했어요. 길게 눌러 복사해 주세요')
  }

  // 내 묶음 '경로 보기': 서버가 본인에게만 주는 home으로 S2(경로 검색)를 연다
  function openMyRoute() {
    if (!me?.home || !group) return
    const search = {
      origin: toPlace(group.meeting_place, 'group-meeting'),
      destination: toPlace(me.home, 'home'),
      departure: leaveAt.slice(11, 16),
    }
    saveSearch(search)
    navigate('/result', { state: search })
  }

  return (
    <div className={styles.page}>
      <AppBar
        leading="back"
        title="모임 결과"
        tone="canvas"
        wide
        className={styles.appBar}
        onBack={() => navigate('/')}
        action={{ label: auto ? '자동 갱신' : '갱신 멈춤', onClick: () => setAuto((v) => !v) }}
      />

      <div className={`page-body ${styles.layout}`} data-layout="wide">
        <h2 className={`${styles.heading} t-title-large`}>모임 결과</h2>

        {!ready ? (
          // S6-b 계산 중 (서버 응답을 기다리는 동안)
          <section className={styles.calculating} aria-busy={!error} aria-live="polite">
            {error ? (
              <>
                <p className="t-heading-medium">모임 결과를 불러오지 못했어요</p>
                <p className={`${styles.muted} t-body-small`}>{error.message}</p>
                <Button variant="secondary" className={styles.raised} onClick={refresh}>
                  다시 불러오기
                </Button>
              </>
            ) : (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                <p className="t-heading-medium">경로를 묶는 중이에요</p>
                <p className={`${styles.muted} t-body-small`}>
                  참여자{group ? ` ${group.members.length}명` : ''}의 도착지로 가장 싼 조합을 찾고
                  있어요
                </p>
                <div className={styles.skeletons} aria-hidden="true">
                  {[0, 1].map((i) => (
                    <div key={i} className={styles.skeleton}>
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : (
          <>
            {/* 요약: 참여 인원 · 갱신 · 공유 */}
            <section className={styles.summary} aria-label="모임 요약">
              <div>
                <p className="t-body-medium-strong">
                  참여 {group.members.length}명{me && ` · 나는 ${me.nickname}`}
                </p>
                <p className="t-body-medium-strong">
                  {auto ? '10초마다 갱신' : '자동 갱신 꺼짐'}
                  {fetchedAt && ` · 마지막 ${clock(fetchedAt)}`}
                  {error && ' · 갱신 실패'}
                </p>
              </div>
              <button
                type="button"
                className={`${styles.share} t-body-small`}
                onClick={handleShare}
              >
                공유
              </button>
            </section>

            <section className={styles.bundles} aria-label="묶음">
              <h2 className="t-heading-medium">묶음 · 출발 마감 빠른 순</h2>
              {bundles.length === 0 ? (
                <p className={`${styles.empty} t-body-small`}>
                  아직 참여한 사람이 없어요. 링크를 단톡방에 보내 주세요
                </p>
              ) : (
                <ul className={styles.list}>
                  {bundles.map((b, i) => (
                    <BundleCard
                      key={b.key}
                      bundle={b}
                      style={{ '--i': i }}
                      onRoute={me?.home ? openMyRoute : undefined}
                    />
                  ))}
                </ul>
              )}
            </section>

            <div className={styles.side}>
              <SettlementSection
                taxiGroups={group.taxi_groups}
                transfers={transfers}
                canSettle={Boolean(adminToken) || Boolean(me)}
                onCopy={handleCopy}
              />

              <MemberManager
                members={group.members}
                isAdmin={Boolean(adminToken)}
                busy={busy}
                onRemove={(m) =>
                  run(() => removeMember(groupId, m.id, adminToken), `${m.nickname}님을 뺐어요`)
                }
                onSaveHome={(place) =>
                  run(
                    () => updateMember(groupId, me.id, { home: place }, saved.memberToken),
                    '도착지를 고쳤어요',
                  )
                }
                onLeave={() =>
                  run(async () => {
                    await removeMember(groupId, me.id, saved.memberToken)
                    saveGroup(groupId, { memberId: null, memberToken: null, nickname: null })
                    onLeft?.()
                  })
                }
                onAdd={(nickname, home) => {
                  if (home?.inSeoul === false) {
                    showToast('아직 서울 안만 지원해요')
                    return false
                  }
                  return run(
                    () => joinGroup(groupId, { nickname, home }, { adminToken }),
                    `${nickname}님을 넣었어요`,
                  )
                }}
                onEnd={() =>
                  run(async () => {
                    await endGroup(groupId, adminToken)
                    onGone?.()
                  })
                }
              />

              <p className={`${styles.muted} t-caption`}>
                다른 사람에게는 동 이름과 가까운 역까지만 보여요 · 택시 요금과 정산은 예상값이에요
              </p>
            </div>
          </>
        )}
      </div>

      <Toast message={toast} />
    </div>
  )
}

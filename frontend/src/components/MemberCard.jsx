import { useState } from 'react'
import { deadlineOf } from '../utils/groupPlan.js'
import Badge from './Badge.jsx'
import Button from './Button.jsx'
import ConfirmButton from './ConfirmButton.jsx'
import Icon from './Icon.jsx'
import PlaceField from './PlaceField.jsx'
import Reveal from './Reveal.jsx'
import styles from './MemberCard.module.css'

const PLAN_TONE = { share: 'primary', taxi: 'default', regular: 'default', night: 'default' }
const PLAN_BADGE = {
  share: '택시 같이',
  taxi: '택시',
  regular: '대중교통',
  night: '심야버스',
  none: '택시',
}

/**
 * S6 참여자 카드 (마감 빠른 순으로 나열)
 * - 다른 사람: 닉네임, area(동 · 가까운 역), 마감, 이 사람의 귀갓길 요약
 * - 나: 내 경로 보기(S2·S3), 집 주소 고치기, 빠지기
 * - 만든 사람: 다른 사람 빼기
 */
export default function MemberCard({
  member,
  plan,
  canRemove,
  busy,
  onRemove,
  onOpenRoute,
  onSaveHome,
  onLeave,
  style,
}) {
  const [editing, setEditing] = useState(false)
  const [home, setHome] = useState({ text: '', place: null })
  const deadline = deadlineOf(member)
  const me = member.is_me

  async function handleSave() {
    if (!home.place) return
    const ok = await onSaveHome(home.place)
    if (ok) {
      setEditing(false)
      setHome({ text: '', place: null })
    }
  }

  return (
    <li className={`${styles.card} ${me ? styles.me : ''}`} style={style}>
      <div className={styles.head}>
        <div className={styles.who}>
          <p className={`${styles.name} t-heading-medium`}>
            {member.nickname}
            {me && <Badge tone="primary">나</Badge>}
            <Badge tone={PLAN_TONE[plan.kind] ?? 'muted'}>{PLAN_BADGE[plan.kind]}</Badge>
          </p>
          <p className={`${styles.area} t-caption`}>{member.area}</p>
        </div>
        <div className={styles.deadline}>
          <span className="t-caption">{deadline.label}</span>
          <span className="t-fare-s">{deadline.time}</span>
        </div>
      </div>

      <div className={styles.plan}>
        <p className="t-body-medium-strong">{plan.title}</p>
        {plan.detail && <p className={`${styles.detail} t-body-small`}>{plan.detail}</p>}
        {plan.warning && (
          <div className={styles.warning}>
            <Badge tone="white">주의</Badge>
            <p className="t-caption">{plan.warning}</p>
          </div>
        )}
      </div>

      {(me || canRemove) && (
        <div className={styles.actions}>
          {me && onOpenRoute && (
            <button type="button" className={`${styles.link} t-label-medium`} onClick={onOpenRoute}>
              내 경로 보기
              <Icon name="chevron-right" size={14} />
            </button>
          )}
          {me && (
            <button
              type="button"
              className={`${styles.link} t-label-medium`}
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
            >
              집 주소 고치기
            </button>
          )}
          <span className={styles.spacer} />
          {me ? (
            <ConfirmButton
              label="빠지기"
              confirmLabel="정말 빠질게요"
              onConfirm={onLeave}
              disabled={busy}
            />
          ) : (
            <ConfirmButton
              label="빼기"
              confirmLabel={`${member.nickname} 빼기`}
              onConfirm={onRemove}
              disabled={busy}
            />
          )}
        </div>
      )}

      {me && (
        <Reveal show={editing} gap={0}>
          <div className={styles.edit}>
            <PlaceField
              label="새 집 주소"
              placeholder="집 주소나 가까운 역"
              value={home}
              onChange={setHome}
              gap={8}
            />
            <Button disabled={!home.place || busy} onClick={handleSave}>
              저장
            </Button>
          </div>
        </Reveal>
      )}
    </li>
  )
}

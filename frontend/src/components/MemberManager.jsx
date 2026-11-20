import { useState } from 'react'
import Button from './Button.jsx'
import ConfirmButton from './ConfirmButton.jsx'
import Field from './Field.jsx'
import PlaceField from './PlaceField.jsx'
import Reveal from './Reveal.jsx'
import styles from './MemberManager.module.css'

const emptyPoint = { text: '', place: null }

/**
 * S6 참여자 (와이어프레임 S6에는 없고, 명세 F3-05·F3-06과 README 기능이라 아래에 작게 둠)
 * - 나: 도착지 고치기, 빠지기 (참여자 토큰)
 * - 만든 사람: 다른 사람 빼기, 대신 넣기, 모임 끝내기 (관리 토큰)
 */
export default function MemberManager({
  members,
  isAdmin,
  busy,
  onRemove,
  onSaveHome,
  onLeave,
  onAdd,
  onEnd,
}) {
  const [editing, setEditing] = useState(false)
  const [home, setHome] = useState(emptyPoint)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [newHome, setNewHome] = useState(emptyPoint)

  async function saveHome() {
    if (!home.place) return
    if (await onSaveHome(home.place)) {
      setEditing(false)
      setHome(emptyPoint)
    }
  }

  async function add(e) {
    e.preventDefault()
    if (await onAdd(name.trim(), newHome.place)) {
      setName('')
      setNewHome(emptyPoint)
      setAdding(false)
    }
  }

  return (
    <section className={styles.section} aria-label="참여자">
      <h2 className="t-heading-medium">참여자 {members.length}명</h2>

      <ul className={styles.list}>
        {members.map((m) => (
          <li key={m.id} className={styles.row}>
            <div className={styles.who}>
              <p className="t-body-medium-strong">
                {m.nickname}
                {m.is_me && <span className={styles.me}> · 나</span>}
              </p>
              <p className={`${styles.muted} t-caption`}>{m.area}</p>
            </div>
            {m.is_me ? (
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${styles.link} t-label-medium`}
                  aria-expanded={editing}
                  onClick={() => setEditing((v) => !v)}
                >
                  도착지 고치기
                </button>
                <ConfirmButton
                  label="빠지기"
                  confirmLabel="정말 빠질게요"
                  onConfirm={onLeave}
                  disabled={busy}
                  tone="danger"
                />
              </div>
            ) : (
              isAdmin && (
                <ConfirmButton
                  label="빼기"
                  confirmLabel={`${m.nickname} 빼기`}
                  onConfirm={() => onRemove(m)}
                  disabled={busy}
                />
              )
            )}
          </li>
        ))}
      </ul>

      <Reveal show={editing} gap={10}>
        <div className={styles.form}>
          <PlaceField
            label="새 도착지"
            placeholder="도착지 검색"
            value={home}
            onChange={setHome}
            gap={10}
          />
          <Button disabled={!home.place || busy} onClick={saveHome}>
            저장
          </Button>
        </div>
      </Reveal>

      {isAdmin && (
        <>
          <button
            type="button"
            className={`${styles.link} t-label-medium`}
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            + 참여자 대신 넣기
          </button>
          <Reveal show={adding} gap={10}>
            <form className={styles.form} onSubmit={add} noValidate>
              <Field
                label="이름"
                placeholder="모임에서 보일 이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
              />
              <PlaceField
                label="그 사람 도착지"
                placeholder="도착지 검색"
                value={newHome}
                onChange={setNewHome}
                gap={16}
              />
              <Button type="submit" disabled={!name.trim() || !newHome.place || busy}>
                넣기
              </Button>
            </form>
          </Reveal>
          <ConfirmButton
            label="모임 끝내기"
            confirmLabel="정말 끝낼게요 (도착지도 바로 지워요)"
            onConfirm={onEnd}
            disabled={busy}
            tone="danger"
            className={styles.end}
          />
        </>
      )}
    </section>
  )
}

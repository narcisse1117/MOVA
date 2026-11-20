import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadGroup } from '../utils/storage.js'
import GroupJoinPage from './GroupJoinPage.jsx'
import PlaceholderPage from './PlaceholderPage.jsx'

/**
 * /g/:groupId — 모임 링크 하나로 S5·S6를 나눠 보여준다
 * 명세 S5: 이미 참여한 기기(참여자 토큰이 있음)면 바로 S6
 */
export default function GroupPage() {
  const { groupId } = useParams()
  // groupId가 바뀌면(다른 모임 링크) key로 새로 그리게 해서 상태가 섞이지 않게 함
  return <GroupRoute key={groupId} groupId={groupId} />
}

function GroupRoute({ groupId }) {
  const [joined, setJoined] = useState(() => Boolean(loadGroup(groupId)?.memberToken))

  if (!joined) return <GroupJoinPage groupId={groupId} onJoined={() => setJoined(true)} />
  // TODO: S6 모임 결과
  return <PlaceholderPage title="모임" code="S6" />
}

import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadGroup } from '../utils/storage.js'
import GroupGoneScreen from './GroupGoneScreen.jsx'
import GroupJoinPage from './GroupJoinPage.jsx'
import GroupResultPage from './GroupResultPage.jsx'

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
  const [view, setView] = useState(() =>
    loadGroup(groupId)?.memberToken ? { name: 'result' } : { name: 'join' },
  )

  const handleLeft = useCallback(
    (notice = '모임에서 빠졌어요. 다시 참여할 수 있어요') => setView({ name: 'join', notice }),
    [],
  )
  const handleGone = useCallback(() => setView({ name: 'gone' }), [])

  if (view.name === 'gone') return <GroupGoneScreen groupId={groupId} />
  if (view.name === 'join') {
    return (
      <GroupJoinPage
        groupId={groupId}
        notice={view.notice}
        onJoined={() => setView({ name: 'result' })}
      />
    )
  }
  return <GroupResultPage groupId={groupId} onLeft={handleLeft} onGone={handleGone} />
}

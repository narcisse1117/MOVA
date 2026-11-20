import { Route, Routes } from 'react-router-dom'
import FeedbackPrompt from './components/FeedbackPrompt.jsx'
import DetailPage from './pages/DetailPage.jsx'
import GroupNewPage from './pages/GroupNewPage.jsx'
import GroupPage from './pages/GroupPage.jsx'
import GroupRoutePage from './pages/GroupRoutePage.jsx'
import InputPage from './pages/InputPage.jsx'
import OutOfAreaPage from './pages/OutOfAreaPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import ResultPage from './pages/ResultPage.jsx'

export default function App() {
  return (
    <>
      <Routes>
        {/* S1 입력 */}
        <Route path="/" element={<InputPage />} />
        {/* E1 서울 밖 주소 안내 */}
        <Route path="/out-of-area" element={<OutOfAreaPage />} />

        {/* S2 결과 */}
        <Route path="/result" element={<ResultPage />} />
        {/* S3 경로 상세 */}
        <Route path="/result/:optionId" element={<DetailPage />} />

        {/* S4 모임 만들기 */}
        <Route path="/group/new" element={<GroupNewPage />} />

        {/* S5 모임 참여 (이미 참여한 기기면 S6) */}
        <Route path="/g/:groupId" element={<GroupPage />} />
        {/* 모임 내 경로 (S6 '경로 보기' → S3 모양) */}
        <Route path="/g/:groupId/route" element={<GroupRoutePage />} />

        {/* 없는 주소 */}
        <Route path="*" element={<PlaceholderPage title="페이지 없음" code="404" />} />
      </Routes>

      {/* S7 도착 후 질문: 안을 고른 뒤 다음 방문 때 어느 화면에서든 한 번 */}
      <FeedbackPrompt />
    </>
  )
}

import { Route, Routes } from 'react-router-dom'
import DetailPage from './pages/DetailPage.jsx'
import InputPage from './pages/InputPage.jsx'
import OutOfAreaPage from './pages/OutOfAreaPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import ResultPage from './pages/ResultPage.jsx'

export default function App() {
  return (
    <Routes>
      {/* S1 입력 */}
      <Route path="/" element={<InputPage />} />
      {/* E1 서울 밖 주소 안내 */}
      <Route path="/out-of-area" element={<OutOfAreaPage />} />

      {/* S2 결과 */}
      <Route path="/result" element={<ResultPage />} />
      {/* S3 경로 상세 */}
      <Route path="/result/:optionId" element={<DetailPage />} />

      {/* 아래 화면들은 다음 단계에서 구현 */}
      <Route path="/group/new" element={<PlaceholderPage title="모임 만들기" code="S4" />} />
      <Route path="/g/:groupId" element={<PlaceholderPage title="모임" code="S5 · S6" />} />
      <Route path="*" element={<PlaceholderPage title="페이지 없음" code="404" />} />
    </Routes>
  )
}

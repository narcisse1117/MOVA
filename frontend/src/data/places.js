// 자동완성 API를 붙이기 전까지 쓰는 임시 장소 데이터
// isSeoul이 false인 장소를 고르면 E1(서울 밖 주소 안내)로 이동한다.
export const PLACES = [
  { id: 'gangnam-11', name: '강남역 11번 출구', region: '서울 강남구', isSeoul: true },
  { id: 'gangnam', name: '강남역 2호선', region: '서울 강남구', isSeoul: true },
  { id: 'suyu-st', name: '수유역 4호선', region: '서울 강북구', isSeoul: true },
  { id: 'suyu-market', name: '수유시장', region: '서울 강북구', isSeoul: true },
  { id: 'sadang', name: '사당역', region: '서울 동작구', isSeoul: true },
  { id: 'hongdae', name: '홍대입구역', region: '서울 마포구', isSeoul: true },
  { id: 'nowon', name: '노원역', region: '서울 노원구', isSeoul: true },
  { id: 'ssangmun', name: '쌍문역', region: '서울 도봉구', isSeoul: true },
  { id: 'jeongja', name: '정자역', region: '경기 성남시 분당구', isSeoul: false },
  { id: 'suwon', name: '수원역', region: '경기 수원시 팔달구', isSeoul: false },
]

export const CURRENT_LOCATION = PLACES[0]

export function searchPlaces(query, homePlace) {
  const q = query.trim().replace(/\s/g, '')
  if (!q) return []

  const matches = PLACES.filter((p) =>
    (p.name + p.region).replace(/\s/g, '').includes(q),
  )

  // 저장된 집은 이름이 맞으면 맨 위에
  if (homePlace && homePlace.name.replace(/\s/g, '').includes(q)) {
    return [
      { ...homePlace, isHome: true },
      ...matches.filter((p) => p.id !== homePlace.sourceId),
    ].slice(0, 5)
  }
  return matches.slice(0, 5)
}

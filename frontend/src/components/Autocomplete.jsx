import { useState } from 'react'
import Reveal from './Reveal.jsx'
import styles from './Autocomplete.module.css'

/** 후보 아래 줄: 저장된 집 / 역(지나는 노선) / 가게·주소(주소). 서울 밖이면 표시 */
function subText(place) {
  if (place.isHome) return '저장된 집'
  const base =
    place.kind === 'station' ? `${place.region} · ${place.address}` : place.address || place.region
  return place.inSeoul === false ? `${base} · 서울 밖` : base
}

/**
 * 입력창 바로 아래에 펼쳐지는 자동완성 목록
 * - 펼침/접힘 모션은 공통 Reveal(collapse)을 사용
 * - 접히는 동안에도 마지막 목록을 보여줘서 내용이 갑자기 사라지지 않게 함
 *
 * @param {object[]} items hooks/usePlaceSearch.js의 장소들
 * @param {string} [status] 목록 대신(또는 아래에) 보여줄 안내 ("찾는 중…", 결과 없음 등)
 * @param {number} [gap=8] 부모 flex gap(px)
 */
export default function Autocomplete({ items, status, onSelect, label = '장소 추천', gap = 8 }) {
  const open = items.length > 0 || Boolean(status)
  const [shown, setShown] = useState({ items, status })

  // 새 내용이 생기면 기억해 두고, 비면(닫힐 때) 이전 내용을 유지
  if (open && (items !== shown.items || status !== shown.status)) {
    setShown({ items, status })
  }

  return (
    <Reveal show={open} gap={gap}>
      <ul
        className={styles.list}
        role="listbox"
        aria-label={label}
        aria-busy={shown.status === '찾는 중…'}
      >
        {shown.items.map((place, i) => (
          <li
            key={place.id}
            role="option"
            aria-selected={i === 0}
            className={styles.item}
            style={{ '--i': i }}
          >
            <button
              type="button"
              className={`${styles.suggestion} ${i === 0 ? styles.active : ''}`}
              // 클릭 순간 입력창 포커스가 빠져 목록이 먼저 닫히는 것을 막음
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(place)}
            >
              <span className={`${styles.name} t-body-medium-strong`}>{place.label}</span>
              <span className={`${styles.sub} t-caption`}>{subText(place)}</span>
            </button>
          </li>
        ))}
        {shown.status && (
          <li className={`${styles.status} t-body-small`} role="status">
            {shown.status}
          </li>
        )}
      </ul>
    </Reveal>
  )
}

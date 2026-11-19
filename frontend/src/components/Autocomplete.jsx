import { useState } from 'react'
import Reveal from './Reveal.jsx'
import styles from './Autocomplete.module.css'

/**
 * 입력창 바로 아래에 펼쳐지는 자동완성 목록
 * - 펼침/접힘 모션은 공통 Reveal(collapse)을 사용
 * - 접히는 동안에도 마지막 목록을 보여줘서 내용이 갑자기 사라지지 않게 함
 *
 * @param {number} [gap=8] 부모 flex gap(px)
 */
export default function Autocomplete({ items, onSelect, label = '장소 추천', gap = 8 }) {
  const open = items.length > 0
  const [shown, setShown] = useState(items)

  // 새 목록이 생기면 기억해 두고, 목록이 비면(닫힐 때) 이전 목록을 유지
  if (open && items !== shown) {
    setShown(items)
  }

  return (
    <Reveal show={open} gap={gap}>
      <ul className={styles.list} role="listbox" aria-label={label}>
        {shown.map((place, i) => (
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
              <span className={`${styles.name} t-body-medium-strong`}>{place.name}</span>
              <span className={`${styles.sub} t-caption`}>
                {place.isHome ? '저장된 집' : place.region}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Reveal>
  )
}

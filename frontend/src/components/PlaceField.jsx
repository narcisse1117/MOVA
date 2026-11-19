import { useState } from 'react'
import { placeStatus, usePlaceSearch, withHome } from '../hooks/usePlaceSearch.js'
import Autocomplete from './Autocomplete.jsx'
import Field from './Field.jsx'
import Icon from './Icon.jsx'

/**
 * 장소 입력칸 + 자동완성 (GET /api/geocode)
 * 입력하면 후보가 칸 바로 아래에 펼쳐지고, 후보를 골라야 place(좌표 포함)가 채워진다.
 *
 * @param {{text: string, place: object|null}} value
 * @param {(value: {text, place}) => void} onChange
 * @param {object} [home] 저장된 집 — 입력어와 맞으면 후보 맨 위에
 * @param {number} [gap=8] 부모 flex gap(px) — 자동완성이 접혀 있을 때 빈 공간 맞춤
 */
export default function PlaceField({
  label,
  placeholder,
  value,
  onChange,
  home,
  gap = 8,
  disabled,
}) {
  const [active, setActive] = useState(false)
  const search = usePlaceSearch(value.text, active && !value.place)
  const items = withHome(search.results, value.text, search.searched && home)

  return (
    <>
      <Field
        label={label}
        placeholder={placeholder}
        value={value.text}
        onChange={(e) => onChange({ text: e.target.value, place: null })}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onKeyDown={(e) => e.key === 'Escape' && setActive(false)}
        autoComplete="off"
        disabled={disabled}
        trailing={value.text && !disabled ? <Icon name="close" size={18} /> : null}
        trailingLabel={`${label} 지우기`}
        onTrailingClick={() => onChange({ text: '', place: null })}
      />
      <Autocomplete
        items={items}
        status={placeStatus(search)}
        label={`${label} 추천`}
        gap={gap}
        onSelect={(place) => {
          onChange({ text: place.label, place })
          setActive(false)
        }}
      />
    </>
  )
}

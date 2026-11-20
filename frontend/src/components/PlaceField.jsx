import { useState } from 'react'
import { reverse } from '../api/index.js'
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
 * @param {boolean} [locatable] 비어 있을 때 오른쪽에 현재 위치 버튼 (브라우저 위치 → GET /api/reverse)
 * @param {(message: string) => void} [onError] 현재 위치를 못 가져왔을 때
 */
export default function PlaceField({
  label,
  placeholder,
  value,
  onChange,
  home,
  gap = 8,
  disabled,
  locatable = false,
  onError,
}) {
  const [active, setActive] = useState(false)
  const [locating, setLocating] = useState(false)
  const search = usePlaceSearch(value.text, active && !value.place)
  const items = withHome(search.results, value.text, search.searched && home)

  function locate() {
    if (!navigator.geolocation) {
      onError?.('이 브라우저에서는 현재 위치를 쓸 수 없어요')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const res = await reverse(coords.latitude, coords.longitude)
          // 서버가 이름을 못 붙이면(네이버 키 없음 등 label: null) '현재 위치'만
          const text = res.label ? `현재 위치 · ${res.label}` : '현재 위치'
          onChange({
            text,
            place: {
              id: 'current',
              kind: 'current',
              label: text,
              name: text,
              region: res.label ?? '',
              lat: coords.latitude,
              lng: coords.longitude,
            },
          })
        } catch (err) {
          onError?.(err.message)
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        onError?.('현재 위치를 가져오지 못했어요. 직접 입력해 주세요')
      },
      { timeout: 10000, maximumAge: 60000 },
    )
  }

  const showLocate = locatable && !value.text && !disabled
  const trailing = showLocate ? (
    <Icon name="locate" size={20} />
  ) : value.text && !disabled ? (
    <Icon name="close" size={18} />
  ) : null

  return (
    <>
      <Field
        label={label}
        placeholder={locating ? '현재 위치를 찾는 중…' : placeholder}
        value={value.text}
        onChange={(e) => onChange({ text: e.target.value, place: null })}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onKeyDown={(e) => e.key === 'Escape' && setActive(false)}
        autoComplete="off"
        disabled={disabled || locating}
        trailing={trailing}
        trailingLabel={showLocate ? '현재 위치로 채우기' : `${label} 지우기`}
        onTrailingClick={showLocate ? locate : () => onChange({ text: '', place: null })}
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

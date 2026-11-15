import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Checkbox from '../components/Checkbox.jsx'
import Field from '../components/Field.jsx'
import SegmentedControl from '../components/SegmentedControl.jsx'
import { CURRENT_LOCATION, searchPlaces } from '../data/places.js'
import { loadHome, saveHome, saveSearch } from '../utils/storage.js'
import { DEPARTURE_OPTIONS, defaultDepartureTime } from '../utils/time.js'
import styles from './InputPage.module.css'

const TIME_MODES = [
  { value: 'now', label: '지금' },
  { value: 'pick', label: '시간 선택' },
]

const emptyPoint = { text: '', place: null }

/** S1 입력 / */
export default function InputPage() {
  const navigate = useNavigate()
  const [home] = useState(loadHome)

  const [origin, setOrigin] = useState({
    text: `현재 위치 · ${CURRENT_LOCATION.name}`,
    place: CURRENT_LOCATION,
  })
  const [destination, setDestination] = useState(emptyPoint)
  const [activeField, setActiveField] = useState(null) // 'origin' | 'destination' | null
  const [saveAsHome, setSaveAsHome] = useState(false)
  const [timeMode, setTimeMode] = useState('pick')
  const [departure, setDeparture] = useState(defaultDepartureTime)
  const [error, setError] = useState('')

  const activePoint = activeField === 'origin' ? origin : destination
  const suggestions = useMemo(() => {
    if (!activeField || activePoint.place) return []
    return searchPlaces(activePoint.text, home)
  }, [activeField, activePoint, home])

  const setPoint = activeField === 'origin' ? setOrigin : setDestination

  function handleType(setter) {
    return (e) => {
      setter({ text: e.target.value, place: null })
      setError('')
    }
  }

  function handleSelect(place) {
    setPoint({ text: place.name, place })
    setActiveField(null)
    setError('')
  }

  function handleSwap() {
    setOrigin(destination)
    setDestination(origin)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!origin.place || !destination.place) {
      setError('출발지와 도착지를 목록에서 골라 주세요')
      return
    }

    const outside = [origin.place, destination.place].find((p) => !p.isSeoul)
    if (outside) {
      navigate('/out-of-area', { state: { address: `${outside.region} ${outside.name}` } })
      return
    }

    if (saveAsHome) saveHome(destination.place)

    const search = {
      origin: origin.place,
      destination: destination.place,
      departure: timeMode === 'now' ? 'now' : departure,
    }
    // 명세: 주소는 URL에 넣지 않음 → 라우터 state + sessionStorage로 전달
    saveSearch(search)
    navigate('/result', { state: search })
  }

  return (
    <>
      <AppBar title="MOVA" action={{ label: '모임 만들기', to: '/group/new' }} />

      <form className="page-body" onSubmit={handleSubmit} noValidate>
        <h2 className={`${styles.hero} t-title-hero`}>
          <span className={styles.accent}>밤 9시</span>부터{' '}
          <span className={styles.muted}>새벽 2시</span>,<br />
          택시와 대중교통을 함께 이용하는
          <br />
          최적의 조합을 찾아보세요
        </h2>

        <section className={styles.route} aria-label="경로 입력">
          <Field
            label="출발지"
            placeholder="출발지를 입력하세요"
            value={origin.text}
            onChange={handleType(setOrigin)}
            onFocus={() => setActiveField('origin')}
            autoComplete="off"
            trailing="◎"
            trailingLabel="현재 위치로 설정"
            onTrailingClick={() =>
              setOrigin({ text: `현재 위치 · ${CURRENT_LOCATION.name}`, place: CURRENT_LOCATION })
            }
          />

          <div className={styles.swapRow}>
            <Badge onClick={handleSwap} aria-label="출발지와 도착지 바꾸기">
              ↑↓ 출발·도착 바꾸기
            </Badge>
          </div>

          <Field
            label="도착지"
            placeholder="도착지를 입력하세요"
            value={destination.text}
            onChange={handleType(setDestination)}
            onFocus={() => setActiveField('destination')}
            autoComplete="off"
            trailing={destination.text ? '×' : null}
            trailingLabel="도착지 지우기"
            onTrailingClick={() => {
              setDestination(emptyPoint)
              setActiveField('destination')
            }}
          />

          {suggestions.length > 0 && (
            <ul className={styles.autocomplete} role="listbox" aria-label="장소 추천">
              {suggestions.map((place, i) => (
                <li key={place.id} role="option" aria-selected={i === 0}>
                  <button
                    type="button"
                    className={`${styles.suggestion} ${i === 0 ? styles.suggestionActive : ''}`}
                    onClick={() => handleSelect(place)}
                  >
                    <span className={`${styles.suggestionName} t-body-medium-strong`}>
                      {place.name}
                    </span>
                    <span className={`${styles.suggestionSub} t-caption`}>
                      {place.isHome ? '저장된 집' : place.region}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Checkbox
            label="이 도착지를 집 주소로 저장 (이 기기에만)"
            checked={saveAsHome}
            onChange={setSaveAsHome}
          />
        </section>

        <div className={styles.timeGroup}>
          <p className={`${styles.label} t-label-medium`} id="time-mode-label">
            출발 시각
          </p>
          <SegmentedControl
            label="출발 시각"
            options={TIME_MODES}
            value={timeMode}
            onChange={setTimeMode}
          />
        </div>

        {timeMode === 'pick' && (
          <>
            <Field label="시간 선택 시">
              {({ id, className }) => (
                <>
                  <select
                    id={id}
                    className={className}
                    value={departure}
                    onChange={(e) => setDeparture(e.target.value)}
                  >
                    {DEPARTURE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <span className={styles.caret} aria-hidden="true">
                    ▼
                  </span>
                </>
              )}
            </Field>
            <p className={`${styles.help} t-caption`}>
              21:00 ~ 02:00 사이, 10분 단위로 고를 수 있어요
            </p>
          </>
        )}

        {error && (
          <p className={`${styles.error} t-body-small`} role="alert">
            {error}
          </p>
        )}

        <Button type="submit">경로 찾기</Button>

        <nav className={`${styles.footer} t-caption`} aria-label="약관">
          <a href="#">개인정보 처리방침</a>
          <a href="#">이용약관</a>
        </nav>
      </form>
    </>
  )
}

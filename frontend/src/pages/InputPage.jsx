import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Checkbox from '../components/Checkbox.jsx'
import Field from '../components/Field.jsx'
import SegmentedControl from '../components/SegmentedControl.jsx'
import { currentPlace, geocode } from '../api.js'
import { loadHome, saveHome, saveSearch } from '../utils/storage.js'
import { HOURS, MINUTES, defaultDepartureTime } from '../utils/time.js'
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

  const [origin, setOrigin] = useState({ text: '현재 위치 찾는 중…', place: null })
  const [destination, setDestination] = useState(emptyPoint)
  const [activeField, setActiveField] = useState(null) // 'origin' | 'destination' | null
  const [saveAsHome, setSaveAsHome] = useState(false)
  const [timeMode, setTimeMode] = useState('pick')
  const [departure, setDeparture] = useState(defaultDepartureTime)
  const [error, setError] = useState('')

  const activePoint = activeField === 'origin' ? origin : destination
  const [found, setFound] = useState({ query: '', list: [] })
  const query = activeField && !activePoint.place ? activePoint.text.trim() : ''

  // 입력이 0.3초 멈추면 서버에 검색 (앞 요청은 취소)
  useEffect(() => {
    if (!query) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const found = await geocode(query, ctrl.signal)
        const q = query.replace(/\s/g, '')
        const homeHit = home && home.name.replace(/\s/g, '').includes(q)
        setFound({ query, list: (homeHit ? [{ ...home, isHome: true }, ...found] : found).slice(0, 6) })
      } catch (err) {
        if (err.name !== 'AbortError') setError('장소 검색이 안 돼요. 잠시 뒤에 다시 해 주세요')
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, home])
  const suggestions = query && found.query === query ? found.list : []

  function findLocation() {
    return currentPlace().then(
      (place) => setOrigin({ text: `현재 위치 · ${place.name}`, place }),
      (err) => {
        setOrigin(emptyPoint)
        setError(err.message)
      },
    )
  }

  function locate() {
    setOrigin({ text: '현재 위치 찾는 중…', place: null })
    findLocation()
  }

  // 처음 열 때 현재 위치 (출발지는 이미 '찾는 중'으로 시작)
  useEffect(() => {
    currentPlace().then(
      (place) => setOrigin({ text: `현재 위치 · ${place.name}`, place }),
      (err) => {
        setOrigin(emptyPoint)
        setError(err.message)
      },
    )
  }, [])

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
            onTrailingClick={locate}
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
                      {place.isHome ? '저장된 집' : [place.region, place.kind === 'station' ? place.address : null].filter(Boolean).join(' · ')}
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
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                ['시', HOURS, departure.slice(0, 2), (v) => setDeparture(`${v}:${departure.slice(3)}`)],
                ['분', MINUTES, departure.slice(3), (v) => setDeparture(`${departure.slice(0, 2)}:${v}`)],
              ].map(([label, opts, value, onPick]) => (
                <div key={label} style={{ flex: 1 }}>
                  <Field label={label}>
                    {({ id, className }) => (
                      <>
                        <select id={id} className={className} value={value} onChange={(e) => onPick(e.target.value)}>
                          {opts.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <span className={styles.caret} aria-hidden="true">▼</span>
                      </>
                    )}
                  </Field>
                </div>
              ))}
            </div>
            <p className={`${styles.help} t-caption`}>
              하루 중 언제든 1분 단위로 고를 수 있어요
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

import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AppBar from '../components/AppBar.jsx'
import Autocomplete from '../components/Autocomplete.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Checkbox from '../components/Checkbox.jsx'
import Field from '../components/Field.jsx'
import Icon from '../components/Icon.jsx'
import Reveal from '../components/Reveal.jsx'
import SegmentedControl from '../components/SegmentedControl.jsx'
import { CURRENT_LOCATION, searchPlaces } from '../data/places.js'
import { loadHome, loadSearch, saveHome, saveSearch } from '../utils/storage.js'
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
  const location = useLocation()
  const [home] = useState(loadHome)
  // S2에서 '수정'·뒤로 가기로 돌아오면 직전 검색 조건을 채워 둔다
  const [previous] = useState(() => (location.state?.edit ? loadSearch() : null))

  const [origin, setOrigin] = useState(() =>
    previous && previous.origin.id !== CURRENT_LOCATION.id
      ? { text: previous.origin.name, place: previous.origin }
      : { text: `현재 위치 · ${CURRENT_LOCATION.name}`, place: CURRENT_LOCATION },
  )
  const [destination, setDestination] = useState(() =>
    previous ? { text: previous.destination.name, place: previous.destination } : emptyPoint,
  )
  const [activeField, setActiveField] = useState(null) // 'origin' | 'destination' | null
  const [saveAsHome, setSaveAsHome] = useState(false)
  const [timeMode, setTimeMode] = useState(previous?.departure === 'now' ? 'now' : 'pick')
  const [departure, setDeparture] = useState(() =>
    previous && previous.departure !== 'now' ? previous.departure : defaultDepartureTime(),
  )
  const [error, setError] = useState('')

  // 입력 중인 칸의 자동완성만 그 칸 바로 아래에 펼친다
  const originSuggestions = useMemo(
    () => (activeField === 'origin' && !origin.place ? searchPlaces(origin.text, home) : []),
    [activeField, origin, home],
  )
  const destinationSuggestions = useMemo(
    () =>
      activeField === 'destination' && !destination.place
        ? searchPlaces(destination.text, home)
        : [],
    [activeField, destination, home],
  )

  function handleType(setter) {
    return (e) => {
      setter({ text: e.target.value, place: null })
      setError('')
    }
  }

  function handleSelect(setter) {
    return (place) => {
      setter({ text: place.name, place })
      setActiveField(null)
      setError('')
    }
  }

  // 입력창 밖으로 포커스가 나가거나 Esc를 누르면 목록 접기
  const closeList = () => setActiveField(null)
  const closeOnEscape = (e) => {
    if (e.key === 'Escape') closeList()
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
        {/* 타이틀 모션: 문구가 한 줄씩 내려오며 나타난 뒤, 6.4초에 MOVA 워드마크로 바뀜 (페이지 진입 시 1회) */}
        <div className={styles.heroWrap}>
          <h2 className={`${styles.hero} t-title-hero`}>
            <span className={styles.heroLine}>
              <span className={styles.accent}>밤 9시</span>부터{' '}
              <span className={styles.muted}>새벽 2시</span>,
            </span>
            <span className={styles.heroLine}>택시와 대중교통을 함께 이용하는</span>
            <span className={styles.heroLine}>최적의 조합을 찾아보세요</span>
          </h2>
          <p className={styles.wordmark} aria-hidden="true">
            MOVA
          </p>
        </div>

        <section className={styles.route} aria-label="경로 입력">
          <Field
            label="출발지"
            placeholder="출발지를 입력하세요"
            value={origin.text}
            onChange={handleType(setOrigin)}
            onFocus={() => setActiveField('origin')}
            onBlur={closeList}
            onKeyDown={closeOnEscape}
            autoComplete="off"
            trailing={<Icon name="locate" size={20} />}
            trailingLabel="현재 위치로 설정"
            onTrailingClick={() =>
              setOrigin({ text: `현재 위치 · ${CURRENT_LOCATION.name}`, place: CURRENT_LOCATION })
            }
          />
          <Autocomplete items={originSuggestions} onSelect={handleSelect(setOrigin)} label="출발지 추천" />

          <div className={styles.swapRow}>
            <Badge onClick={handleSwap} aria-label="출발지와 도착지 바꾸기">
              <Icon name="swap-vertical" size={12} /> 출발·도착 바꾸기
            </Badge>
          </div>

          <Field
            label="도착지"
            placeholder="도착지를 입력하세요"
            value={destination.text}
            onChange={handleType(setDestination)}
            onFocus={() => setActiveField('destination')}
            onBlur={closeList}
            onKeyDown={closeOnEscape}
            autoComplete="off"
            trailing={destination.text ? <Icon name="close" size={18} /> : null}
            trailingLabel="도착지 지우기"
            onTrailingClick={() => {
              setDestination(emptyPoint)
              setActiveField('destination')
            }}
          />

          <Autocomplete
            items={destinationSuggestions}
            onSelect={handleSelect(setDestination)}
            label="도착지 추천"
          />

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

        <Reveal show={timeMode === 'pick'} gap={16}>
          <div className={styles.stack}>
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
                  <Icon name="chevron-down" size={20} className={styles.caret} />
                </>
              )}
            </Field>
            <p className={`${styles.help} t-caption`}>
              21:00 ~ 02:00 사이, 10분 단위로 고를 수 있어요
            </p>
          </div>
        </Reveal>

        <Reveal show={Boolean(error)} gap={16}>
          <p className={`${styles.error} t-body-small`} role="alert">
            {error}
          </p>
        </Reveal>

        <Button type="submit">경로 찾기</Button>

        <nav className={`${styles.footer} t-caption`} aria-label="약관">
          <a href="#">개인정보 처리방침</a>
          <a href="#">이용약관</a>
        </nav>
      </form>
    </>
  )
}

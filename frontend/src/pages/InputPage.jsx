import { useState } from 'react'
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
import { reverse } from '../api/index.js'
import { usePlaceSearch } from '../hooks/usePlaceSearch.js'
import { loadHome, loadSearch, saveHome, saveSearch } from '../utils/storage.js'
import { DEPARTURE_OPTIONS, defaultDepartureTime } from '../utils/time.js'
import styles from './InputPage.module.css'

const TIME_MODES = [
  { value: 'now', label: '지금' },
  { value: 'pick', label: '시간 선택' },
]

const emptyPoint = { text: '', place: null }

/** 예전 형식(좌표 없음)으로 저장된 집은 쓰지 않음 */
function loadValidHome() {
  const home = loadHome()
  return home && home.lat != null && home.label ? home : null
}

/** 저장된 집이 입력어와 맞으면 후보 맨 위에 */
function withHome(results, query, home) {
  const q = query.replace(/\s/g, '')
  if (!home || !q || !home.label.replace(/\s/g, '').includes(q)) return results
  return [{ ...home, id: 'home', isHome: true }, ...results.filter((p) => p.id !== home.sourceId)]
}

/** 자동완성 아래 안내 줄 (명세 오류 처리: 주소를 찾지 못함) */
function statusOf(search) {
  if (search.loading) return '찾는 중…'
  if (search.error) return search.error
  if (search.notes.length > 0) return search.notes[0]
  if (search.searched && search.results.length === 0) {
    return '주소를 찾지 못했어요. 역 이름으로도 검색할 수 있어요'
  }
  return ''
}

/** S1 입력 / */
export default function InputPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [home] = useState(loadValidHome)
  // S2에서 '수정'·뒤로 가기로 돌아오면 직전 검색 조건을 채워 둔다
  const [previous] = useState(() => (location.state?.edit ? loadSearch() : null))

  const [origin, setOrigin] = useState(() =>
    previous?.origin?.label ? { text: previous.origin.label, place: previous.origin } : emptyPoint,
  )
  const [destination, setDestination] = useState(() => {
    if (previous?.destination?.label) {
      return { text: previous.destination.label, place: previous.destination }
    }
    // 명세: 저장한 집 주소가 있으면 도착지 기본값
    return home ? { text: home.label, place: home } : emptyPoint
  })
  const [activeField, setActiveField] = useState(null) // 'origin' | 'destination' | null
  const [saveAsHome, setSaveAsHome] = useState(false)
  const [timeMode, setTimeMode] = useState(previous?.departure === 'now' ? 'now' : 'pick')
  const [departure, setDeparture] = useState(() =>
    previous && previous.departure !== 'now' ? previous.departure : defaultDepartureTime(),
  )
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)

  // 입력 중인 칸만 GET /api/geocode로 후보를 찾아 그 칸 바로 아래에 펼친다
  const originSearch = usePlaceSearch(origin.text, activeField === 'origin' && !origin.place)
  const destinationSearch = usePlaceSearch(
    destination.text,
    activeField === 'destination' && !destination.place,
  )
  const originSuggestions = withHome(
    originSearch.results,
    origin.text,
    originSearch.searched && home,
  )
  const destinationSuggestions = withHome(
    destinationSearch.results,
    destination.text,
    destinationSearch.searched && home,
  )

  function handleType(setter) {
    return (e) => {
      setter({ text: e.target.value, place: null })
      setError('')
    }
  }

  function handleSelect(setter) {
    return (place) => {
      setter({ text: place.label, place })
      setActiveField(null)
      setError('')
    }
  }

  // 입력창 밖으로 포커스가 나가거나 Esc를 누르면 목록 접기
  const closeList = () => setActiveField(null)
  const closeOnEscape = (e) => {
    if (e.key === 'Escape') closeList()
  }

  // 현재 위치: 브라우저 위치 → GET /api/reverse로 이름 붙이기
  // TODO(명세 미정 사항): 위치정보법 신고 여부가 정해지면 버튼을 유지할지 결정
  function handleLocate() {
    if (!navigator.geolocation) {
      setError('이 브라우저에서는 현재 위치를 쓸 수 없어요')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const res = await reverse(coords.latitude, coords.longitude)
          // 서버가 이름을 못 붙이면(네이버 키 없음 등 label: null) '현재 위치'만
          const label = res.label ? `현재 위치 · ${res.label}` : '현재 위치'
          setOrigin({
            text: label,
            place: {
              id: 'current',
              kind: 'current',
              label,
              name: label,
              region: res.label ?? '',
              lat: coords.latitude,
              lng: coords.longitude,
            },
          })
          setError('')
        } catch (err) {
          setError(err.message)
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        setError('현재 위치를 가져오지 못했어요. 출발지를 직접 입력해 주세요')
      },
      { timeout: 10000, maximumAge: 60000 },
    )
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

    // 명세 C-06 + 서버 /api/geocode의 in_seoul: 서울 밖이면 계산하지 않고 안내(E1)
    const outside = [origin.place, destination.place].find((p) => p.inSeoul === false)
    if (outside) {
      navigate('/out-of-area', { state: { address: `${outside.region} ${outside.label}` } })
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
      <AppBar
        title="MOVA"
        className={styles.appBar}
        action={{ label: '모임 만들기', to: '/group/new' }}
      />

      {/* data-layout="wide": 데스크톱에서 이 화면만 넓은 레이아웃을 쓰도록 표시 (index.css) */}
      <form
        className={`page-body ${styles.layout}`}
        data-layout="wide"
        onSubmit={handleSubmit}
        noValidate
      >
        {/* 데스크톱: 왼쪽 소개 / 오른쪽 입력 카드. 모바일에서는 두 묶음이 사라지고 한 줄로 쌓임 */}
        <div className={styles.intro}>
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
        </div>

        <div className={styles.panel}>
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
              trailingLabel={locating ? '현재 위치 찾는 중' : '현재 위치로 설정'}
              onTrailingClick={handleLocate}
            />
            <Autocomplete
              items={originSuggestions}
              status={statusOf(originSearch)}
              onSelect={handleSelect(setOrigin)}
              label="출발지 추천"
            />

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
              status={statusOf(destinationSearch)}
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
        </div>
      </form>
    </>
  )
}

// ⚠️ 경로 API를 붙이기 전까지 쓰는 임시 데이터
// Figma S2의 예시(강남역 → 수유)를 기준으로, 출발 시각에 따라
// 도착 시각·막차 여부·환승 여유·심야 할증이 달라지게만 계산한다.
import { fromMinutes } from '../utils/time.js'

// 화면 하단 안내 문구에 쓰는 시간표 기준일 (명세 C-04)
export const TIMETABLE_DATE = '2026.11.01'

const NIGHT_SURCHARGE_FROM = 22 * 60 // 22:00부터 심야 할증
const HEADWAY = 6 // 지하철 배차 간격(분)

// 사당역 4호선(당고개 방면) 막차 출발 23:55, 환승 통로 도보 3분
const LINE4_LAST_AT_SADANG = 23 * 60 + 55
const TRANSFER_WALK = 3

/** 사당역에 도착한 시각 기준으로 탈 수 있는 4호선 열차 출발 시각 (없으면 null) */
function nextLine4(arriveAtPlatform) {
  if (arriveAtPlatform > LINE4_LAST_AT_SADANG) return null
  const gap = LINE4_LAST_AT_SADANG - arriveAtPlatform
  return LINE4_LAST_AT_SADANG - Math.floor(gap / HEADWAY) * HEADWAY
}

export const LEG_MODES = {
  taxi: '택시',
  line2: '2호선',
  line4: '4호선',
  walk: '도보',
  none: '연결 없음',
}

/**
 * @param {number} dep 출발 시각(분, utils/time.js의 departureMinutes 결과)
 * @returns 카드 목록 (명세 F2-08 추천순: 탈 수 있는 안 먼저, 그 안에서 추천 조합 → 택시 직행 → 대중교통만)
 */
export function buildRouteOptions(dep) {
  const night = dep >= NIGHT_SURCHARGE_FROM

  // ── 택시 직행 ──
  const taxiFare = night ? [23000, 26000] : [19000, 21500]
  const taxiDirect = {
    id: 'taxi',
    type: 'taxi',
    badge: '택시 직행',
    title: '택시만',
    fareMin: taxiFare[0],
    fareMax: taxiFare[1],
    note: night ? '심야 할증 포함' : '일반 요금',
    durationMin: 38,
    arrival: fromMinutes(dep + 38),
    legs: [{ mode: 'taxi', minutes: 38 }],
    available: true,
  }

  // ── 추천 조합: 택시로 사당역 → 4호선 → 도보 ──
  const comboTaxi = 12
  const atPlatform = dep + comboTaxi + TRANSFER_WALK
  const comboTrain = nextLine4(atPlatform)
  const comboFare = night ? [14000, 16000] : [12000, 13500]
  const combo =
    comboTrain === null
      ? {
          id: 'combo',
          type: 'combo',
          badge: '추천 조합',
          title: '택시 + 지하철',
          fareMin: comboFare[0],
          fareMax: comboFare[1],
          available: false,
          unavailableReason: `4호선 막차(${fromMinutes(LINE4_LAST_AT_SADANG)})를 탈 수 없어요`,
          legs: [
            { mode: 'taxi', minutes: comboTaxi },
            { mode: 'none', minutes: 37 },
          ],
        }
      : {
          id: 'combo',
          type: 'combo',
          badge: '추천 조합',
          title: '택시 + 지하철',
          fareMin: comboFare[0],
          fareMax: comboFare[1],
          durationMin: comboTrain + 30 + 7 - dep,
          arrival: fromMinutes(comboTrain + 30 + 7),
          legs: [
            { mode: 'taxi', minutes: comboTaxi },
            { mode: 'line4', minutes: 30 },
            { mode: 'walk', minutes: 7 },
          ],
          transfer: { station: '사당역', margin: comboTrain - atPlatform + TRANSFER_WALK },
          available: true,
        }

  if (combo.available) {
    // 택시 직행보다 아끼는 금액 (최소 요금 기준, 1,000원 단위로 내림)
    const saving = Math.floor((taxiDirect.fareMin - combo.fareMin) / 1000) * 1000
    combo.note = `택시 직행보다 약 ${saving.toLocaleString('ko-KR')}원 절약`
  }

  // ── 대중교통만: 2호선으로 사당 → 4호선 → 도보 ──
  const transitLine2 = 14
  const transitTrain = nextLine4(dep + transitLine2 + TRANSFER_WALK)
  const transit =
    transitTrain === null
      ? {
          id: 'transit',
          type: 'transit',
          badge: '대중교통만',
          title: '지하철',
          fareMin: 1550,
          fareMax: 1550,
          available: false,
          unavailableReason: `4호선 막차(${fromMinutes(LINE4_LAST_AT_SADANG)})를 탈 수 없어요`,
          legs: [
            { mode: 'line2', minutes: transitLine2 },
            { mode: 'none', minutes: 20 },
          ],
        }
      : {
          id: 'transit',
          type: 'transit',
          badge: '대중교통만',
          title: '지하철',
          fareMin: 1550,
          fareMax: 1550,
          note: '교통카드 기준',
          durationMin: transitTrain + 30 + 7 - dep,
          arrival: fromMinutes(transitTrain + 30 + 7),
          legs: [
            { mode: 'line2', minutes: transitLine2 },
            { mode: 'line4', minutes: 30 },
            { mode: 'walk', minutes: 7 },
          ],
          transfer: {
            station: '사당역',
            margin: transitTrain - (dep + transitLine2 + TRANSFER_WALK) + TRANSFER_WALK,
          },
          available: true,
        }

  const ordered = [combo, taxiDirect, transit]
  return [...ordered.filter((o) => o.available), ...ordered.filter((o) => !o.available)]
}

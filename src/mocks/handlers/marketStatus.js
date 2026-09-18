import { http, HttpResponse } from 'msw'
import { marketStatusResponse } from '../fixtures/marketStatus'

/*
 * 市場状況（`GET /market-status`）。
 *
 * **実 API は実装済み**だが、単体テストと E2E がこの handlers を共用しているので残してある
 * （海外休場日・受注不可日・スライス基準と同じ例外扱い）。返す形は実 API と同じ。
 *
 * フィクスチャは 2026-03-02 固定なので、そのまま返すとブラウザでも E2E でも常に「終了後」になり、
 * 現在セッションの強調が一度も描画されない。そこで**日付部分だけを「今日（JST）」へずらし**、
 * ずらした窓に現在時刻が入るかどうかで `現在` と `現在のセッション` を計算し直す。
 * 基準日は、いまが取引時間帯に入る側（今日 / 前日）を選ぶ。
 * どちらにも入らない時間（JST の昼間）は今日を基準日にして「開場前」を返す。
 *
 * **曜日では挙動を変えない**（土日に休場を返すと E2E が週末に落ちる）。
 * 休場・短縮取引は server.use() / mockApi() の差し替えで表現する。
 *
 * ここでは src/utils/ を import しない（モックはバックエンド側の模倣なので、
 * フロントの変換ロジックと共倒れしないようにする）。
 */

/** セッション外のときにサーバが返す値（`現在のセッション` は enum 宣言の無い素の string） */
const OUT_OF_SESSION = {
  beforeOpen: { code: 'BEFORE_OPEN', 名: 'Before Open', 名称: '開場前' },
  closed: { code: 'CLOSED', 名: 'Closed', 名称: '終了後' },
}

const DAY_MS = 86_400_000

/** 20260302 → '2026-03-02'（Date に通さない） */
function toIsoDate(yyyymmdd) {
  const digits = String(yyyymmdd)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** 'YYYY-MM-DD' に日数を足す。UTC 深夜どうしの計算なのでタイムゾーンの影響を受けない */
function addDays(isoDate, days) {
  const shifted = new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS)
  return shifted.toISOString().slice(0, 10)
}

/** tz 付き ISO の日付部分だけをずらす（時刻とオフセットはそのまま） */
function shiftIso(iso, days) {
  return `${addDays(iso.slice(0, 10), days)}${iso.slice(10)}`
}

/** epoch ミリ秒の「JST での日付」 */
function jstDate(ms) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' どうしの日数差 */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** フィクスチャ全体の日付を days だけずらす（現在セッションの計算はまだしない） */
function shiftResponse(days) {
  const base = marketStatusResponse
  return {
    ...base,
    基準日: Number(addDays(toIsoDate(base.基準日), days).replaceAll('-', '')),
    現在時刻_JST: shiftIso(base.現在時刻_JST, days),
    現在時刻_ET: shiftIso(base.現在時刻_ET, days),
    sessions: base.sessions.map((session) => ({
      ...session,
      JPN開始: shiftIso(session.JPN開始, days),
      JPN終了: shiftIso(session.JPN終了, days),
    })),
  }
}

/** 最初のセッションの開始から最後のセッションの終了までに now が入るか */
function inTradingSpan(sessions, nowMs) {
  return nowMs >= Date.parse(sessions[0].JPN開始) && nowMs < Date.parse(sessions.at(-1).JPN終了)
}

/** `現在` と `現在のセッション` 系を now から計算し直す */
function withCurrentSession(response, nowMs) {
  const sessions = response.sessions.map((session) => ({
    ...session,
    現在: nowMs >= Date.parse(session.JPN開始) && nowMs < Date.parse(session.JPN終了),
  }))

  const current = sessions.find((session) => session.現在)
  const fallback =
    nowMs < Date.parse(sessions[0].JPN開始) ? OUT_OF_SESSION.beforeOpen : OUT_OF_SESSION.closed

  return {
    ...response,
    sessions,
    現在のセッション: current?.code ?? fallback.code,
    現在のセッション名: current?.name ?? fallback.名,
    現在のセッション名称: current?.名称 ?? fallback.名称,
  }
}

/** 今日（JST）を基準にした応答。取引時間帯に入る側があればそちらを選ぶ */
function todaysMarketStatus(nowMs) {
  const baseIso = toIsoDate(marketStatusResponse.基準日)
  const today = daysBetween(baseIso, jstDate(nowMs))

  // 前日を基準日にすると、JST 未明のレギュラー / アフターがそのまま現在の窓になる
  const days = [today, today - 1].find((d) => inTradingSpan(shiftResponse(d).sessions, nowMs))

  return withCurrentSession(shiftResponse(days ?? today), nowMs)
}

export const marketStatusHandlers = [
  http.get('*/api/market-status', () => {
    return HttpResponse.json(todaysMarketStatus(Date.now()))
  }),
]

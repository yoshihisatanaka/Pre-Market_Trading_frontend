/**
 * ヘッダの市場状況の表示内容を組み立てる（純関数）。
 *
 * **ローカルの時刻からセッションを推定しない。** 以前ここには Intl でニューヨーク現地時刻を
 * 求めて区切りと突き合わせる getMarketStatus() があったが、祝日・短縮取引・プレ拡大期間を
 * 知らないため、感謝祭の NY 10:00 に「● Regular」と出してしまっていた。発注システムで
 * 「推定」と「実データ」が同じ見た目で出るのは危ないので、判定ごと `GET /market-status` に移した。
 *
 * 現在セッションの判定は `startJst` / `endJst`（tz 付き ISO の絶対時刻）の比較だけで済む。
 * **タイムゾーンも夏時間も日跨ぎの計算も要らない。** 祝日と短縮取引はサーバが境界に
 * 織り込んで返すので、この関数が祝日を知らなくても誤らない。
 */

/*
 * セッションコード → 表示。api/ の *Enum の写しではなく画面側の対応表なので
 * utils に置く（utils/caTypes.js / utils/marketHolidayTypes.js と同じ枠）。
 * **utils/apiEnums.js には置けない** — あれは openapi の *Enum の機械的な写し専用で、
 * 手書きを混ぜると AEN-01 が落ちる。そもそも `現在のセッション` に enum 宣言が無い。
 *
 * ラベルは Manus モック（docs/mock/layout/masters-users.html）と tokens.css の配色に
 * 合わせた英語 + 丸印のまま。API の `現在のセッション名称`（日本語）は使わず、
 * 日本語の短い名は幅に余裕のある時間帯グリッド側で使う。
 */
const SESSION_DISPLAY = {
  PRE: { key: 'premarket', label: '● Pre-Market' },
  REGULAR: { key: 'regular', label: '● Regular' },
  AFTER: { key: 'afterhours', label: '● After-Hours' },
}

/** 取引時間帯の外（開場前・終了後・休場）。BEFORE_OPEN と CLOSED は畳んで同じ見た目にする */
const CLOSED_DISPLAY = { key: 'closed', label: '○ Closed' }

/** まだ取れていない。推定を出さず「わからない」を出す */
const UNKNOWN_DISPLAY = { key: 'unknown', label: '—' }

const FAILED_NOTE = '市場状況を取得できません'

/**
 * @typedef {{ code: string, key: string, name: string, hoursJst: string, hoursEt: string,
 *   current: boolean }} MarketDisplaySession
 */

/**
 * @typedef {{ key: string, label: string, sessions: MarketDisplaySession[], note: string,
 *   shortened: boolean, title: string }} MarketDisplay
 */

/**
 * 市場状況を、ヘッダが描くだけでよい形にする。
 *
 * 取得済みのまま失敗した場合（status があって error もある）は**古い値を出し続ける**。
 * 一時的な通信断で、直前まで出ていた時間帯が消えるほうが紛らわしいため。
 *
 * @param {import('@/api/marketStatus').MarketStatus | null} status ストアが持つ応答。未取得は null
 * @param {number | Date} [now] 判定に使う現在時刻
 * @param {{ error?: Error | null }} [options] 取得に失敗しているときのエラー
 * @returns {MarketDisplay}
 */
export function toMarketDisplay(status, now = Date.now(), { error = null } = {}) {
  if (!status) {
    return {
      ...UNKNOWN_DISPLAY,
      sessions: [],
      note: error ? FAILED_NOTE : '',
      shortened: false,
      title: error?.message ?? '',
    }
  }

  // 休場の日は sessions ごと空で返る。セッション判定より前に置く
  if (status.closed || (status.sessions ?? []).length === 0) {
    return {
      ...CLOSED_DISPLAY,
      sessions: [],
      note: status.closedReason ? `休場（${status.closedReason}）` : '休場',
      shortened: false,
      title: toTitle(status, []),
    }
  }

  const nowMs = Number(now)
  const sessions = status.sessions.map((session) => ({
    code: session.code,
    // 未知のコードでも落とさない（綴りが変わっても表示が壊れないように）
    key: SESSION_DISPLAY[session.code]?.key ?? CLOSED_DISPLAY.key,
    name: session.name,
    hoursJst: withNextDayMark(session),
    hoursEt: session.hoursEt,
    current: isCurrent(session, nowMs),
  }))

  const current = sessions.find((session) => session.current)
  const display = (current && SESSION_DISPLAY[current.code]) || CLOSED_DISPLAY

  return {
    key: display.key,
    label: display.label,
    sessions,
    note: '',
    shortened: Boolean(status.shortened),
    title: toTitle(status, sessions),
  }
}

/**
 * now がこのセッションの窓に入っているか（**開始以上・終了未満**）。
 * 絶対時刻どうしの比較なので、日跨ぎでもタイムゾーンでも壊れない。
 */
function isCurrent(session, nowMs) {
  const start = Date.parse(session.startJst)
  const end = Date.parse(session.endJst)
  if (Number.isNaN(start) || Number.isNaN(end)) return false

  return nowMs >= start && nowMs < end
}

/**
 * 日跨ぎのセッションの JST 表記に (翌) を付ける（レギュラーの '23:30 - 06:00' は翌日の 06:00）。
 *
 * **'HH:MM - HH:MM' の文字列をパースして判定しない。** 当日日付を足すと前倒しになる。
 * 判定は tz 付き ISO の日付部分どうしの比較で行う。
 */
function withNextDayMark(session) {
  const crossesMidnight = session.startJst.slice(0, 10) !== session.endJst.slice(0, 10)
  return crossesMidnight ? `${session.hoursJst}(翌)` : session.hoursJst
}

/**
 * title 属性に出す全文。可視領域を増やさずに、基準日・サマータイム・3 セッションの
 * JST / ET・休場や短縮取引の理由をまとめて見せる。
 */
function toTitle(status, sessions) {
  const lines = [`基準日 ${status.baseDate}（${status.dst ? 'EDT' : 'EST'}）`]

  for (const session of sessions) {
    lines.push(`${session.name} JST ${session.hoursJst} / ET ${session.hoursEt}`)
  }
  if (status.closed) {
    lines.push(status.closedReason ? `休場: ${status.closedReason}` : '休場')
  }
  if (status.shortened) {
    lines.push(status.shortenedReason ? `短縮取引: ${status.shortenedReason}` : '短縮取引')
  }

  return lines.join('\n')
}

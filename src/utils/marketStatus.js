/**
 * ヘッダの市場状況の表示内容を組み立てる（純関数）。
 *
 * **ローカルの時刻からセッションを推定しない。** 以前ここには Intl でニューヨーク現地時刻を
 * 求めて区切りと突き合わせる getMarketStatus() があったが、祝日・短縮取引・プレ拡大期間を
 * 知らないため、感謝祭の NY 10:00 に「Regular」と出してしまっていた。発注システムで
 * 「推定」と「実データ」が同じ見た目で出るのは危ないので、判定ごと `GET /market-status` に移した。
 *
 * 現在セッションの判定は `startJst` / `endJst`（tz 付き ISO の絶対時刻）の比較だけで済む。
 * **タイムゾーンも夏時間も日跨ぎの計算も要らない。** 祝日と短縮取引はサーバが境界に
 * 織り込んで返すので、この関数が祝日を知らなくても誤らない。
 *
 * 見た目は Manus モック（`../premarket-order-202609` の base.html、08986d1）のバッジ 1 個に合わせる:
 *   [●] Pre-Market │ 日本時間 17:00–22:30（夏時間）  ET 04:00–09:30
 * モックはセッション外でも「次に開くまでの窓」を、休場日は理由を JST 側に出す。
 */

/*
 * セッションコード → 表示。api/ の *Enum の写しではなく画面側の対応表なので
 * utils に置く（utils/caTypes.js / utils/marketHolidayTypes.js と同じ枠）。
 * **utils/apiEnums.js には置けない** — あれは openapi の *Enum の機械的な写し専用で、
 * 手書きを混ぜると AEN-01 が落ちる。そもそも `現在のセッション` に enum 宣言が無い。
 *
 * ラベルはモックと同じ英語表記。丸印は AppHeader が要素で描くので文字には含めない。
 */
const SESSION_DISPLAY = {
  PRE: { key: 'premarket', label: 'Pre-Market' },
  REGULAR: { key: 'regular', label: 'Regular' },
  AFTER: { key: 'afterhours', label: 'After-Hours' },
}

/** 営業日のセッション外（開場前・終了後）。BEFORE_OPEN と CLOSED は畳んで同じ見た目にする */
const CLOSED_DISPLAY = { key: 'closed', label: 'Closed' }

/** 土日・終日休場日。ラベルはセッション外と同じ Closed だが、配色と JST / ET 側の文言が違う */
const HOLIDAY_DISPLAY = { key: 'holiday', label: 'Closed' }

/** まだ取れていない。推定を出さず「わからない」を出す */
const UNKNOWN_DISPLAY = { key: 'unknown', label: '—' }

/** 土日のときの `休場理由`。openapi の説明で固定の値（m_海外休場日 の理由とは別枠） */
const WEEKEND_REASON = '土日'

const FAILED_NOTE = '市場状況を取得できません'

/**
 * @typedef {{ key: string, label: string, jst: string, et: string, title: string }} MarketDisplay
 *   jst は JST 側の文言（時間帯・休場理由・取得失敗の断り書き）。et は ET 側の文言。
 *   出すものが無ければどちらも空文字
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
      jst: error ? FAILED_NOTE : '',
      et: '',
      title: error?.message ?? '',
    }
  }

  const sessions = status.sessions ?? []
  const title = toTitle(status)

  // 休場の日は sessions ごと空で返る。セッション判定より前に置く
  if (status.closed || sessions.length === 0) {
    return { ...HOLIDAY_DISPLAY, ...toHolidayText(status.closedReason), title }
  }

  const season = status.dst ? '夏時間' : '冬時間'
  const nowMs = Number(now)
  const current = sessions.find((session) => isCurrent(session, nowMs))

  // セッション外は「最後のセッションの終了 → 最初のセッションの開始」を出す（モックと同じく 翌 は付けない）
  if (!current) {
    const first = sessions[0]
    const last = sessions[sessions.length - 1]
    return {
      ...CLOSED_DISPLAY,
      jst: toJstText(gapRange(last.hoursJst, first.hoursJst), season),
      et: toEtText(gapRange(last.hoursEt, first.hoursEt)),
      title,
    }
  }

  // 未知のコードでも落とさない（綴りが変わっても表示が壊れないように）
  const display = SESSION_DISPLAY[current.code] ?? CLOSED_DISPLAY

  return {
    ...display,
    jst: toJstText(formatJstRange(current, status.baseDate), season),
    et: toEtText(formatRange(current.hoursEt)),
    title,
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

/** 土日と終日休場日の JST / ET 側の文言。土日だけモックの「週末」表記に寄せる */
function toHolidayText(reason) {
  if (reason === WEEKEND_REASON) return { jst: '休場（週末）', et: 'ET Weekend' }

  return { jst: reason ? `休場（${reason}）` : '休場', et: 'ET Market Holiday' }
}

const toJstText = (range, season) => (range ? `日本時間 ${range}（${season}）` : '')
const toEtText = (range) => (range ? `ET ${range}` : '')

/** 'HH:MM - HH:MM' を [開始, 終了] に割る。形が違えば null（表示を壊さず素通しするため） */
function splitHours(text) {
  const match = /^\s*(\S+)\s*-\s*(\S+)\s*$/.exec(text ?? '')
  return match ? [match[1], match[2]] : null
}

/** '04:00 - 09:30' → '04:00–09:30'（モックの表記）。割れなければそのまま返す */
function formatRange(text) {
  const hours = splitHours(text)
  return hours ? `${hours[0]}–${hours[1]}` : (text ?? '')
}

/**
 * JST の時間帯を、日跨ぎの端点に 翌 を前置して組み立てる（'23:30 - 06:00' → '23:30–翌06:00'）。
 *
 * **'HH:MM' の文字列から日跨ぎを推し量らない。** 判定は tz 付き ISO の日付部分と、
 * 米国の取引日である基準日との比較で行う（プレの 18:00 JST は基準日と同じ日付になる）。
 */
function formatJstRange(session, baseDate) {
  const hours = splitHours(session.hoursJst)
  if (!hours) return session.hoursJst ?? ''

  const mark = (iso) => (baseDate && (iso ?? '').slice(0, 10) > baseDate ? '翌' : '')
  return `${mark(session.startJst)}${hours[0]}–${mark(session.endJst)}${hours[1]}`
}

/** 前のセッションの終了から次のセッションの開始まで。どちらかが割れなければ出さない */
function gapRange(lastText, firstText) {
  const last = splitHours(lastText)
  const first = splitHours(firstText)
  return last && first ? `${last[1]}–${first[0]}` : ''
}

/**
 * title 属性に出す全文。可視領域を増やさずに、基準日・サマータイム・3 セッションの
 * JST / ET・休場や短縮取引の理由をまとめて見せる。
 * 短縮取引はモックのヘッダに目印が無いので、ここにだけ出す。
 */
function toTitle(status) {
  const lines = [`基準日 ${status.baseDate}（${status.dst ? 'EDT' : 'EST'}）`]

  for (const session of status.sessions ?? []) {
    const jst = formatJstRange(session, status.baseDate)
    lines.push(`${session.name} JST ${jst} / ET ${formatRange(session.hoursEt)}`)
  }
  if (status.closed) {
    lines.push(status.closedReason ? `休場: ${status.closedReason}` : '休場')
  }
  if (status.shortened) {
    lines.push(status.shortenedReason ? `短縮取引: ${status.shortenedReason}` : '短縮取引')
  }

  return lines.join('\n')
}

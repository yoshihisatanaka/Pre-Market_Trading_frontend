const decimal = new Intl.NumberFormat('ja-JP')

// 通貨記号ではなく「ドル」を後ろに置く表記用。金額なので小数第 2 位まで固定する
const usdDecimal = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateTime = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// 年を落とした短い日時（`08/27 09:10`）。列幅の狭い一覧の「最終更新」向け
const monthDayTime = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/*
 * 金額は全画面で「数字 + 半角スペース + 単位」に揃える（2026-09-28 決定）。
 * 円は「1,200,000 円」、ドルは「2,999.00 ドル」。通貨記号（$ / ¥ / USD）を前置しない。
 */

/**
 * 米ドル建ての価格を「227.16 ドル」の形に整形する。
 */
export function formatUsdUnit(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${usdDecimal.format(value)} ドル`
}

/**
 * formatUsdUnit と同じ（「227.16 ドル」）。
 *
 * かつては通貨記号を前置する（`$1,234.56`）注文系の画面向けだったが、全画面で単位の後置に
 * 揃えたので中身を formatUsdUnit にした。名前を残すのは、並行して作業中のブランチの
 * 呼び出しを壊さないため。**新しいコードは formatUsdUnit を使う。**
 */
export const formatUsd = formatUsdUnit

/**
 * 円建ての金額を「3,500,000 円」の形に整形する（formatUsdUnit と対になる）。
 */
export function formatJpyUnit(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${decimal.format(value)} 円`
}

/** 株数などの整数を表示用に整形する */
export function formatQuantity(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return decimal.format(value)
}

/** ISO8601 文字列を表示用の日時に整形する */
export function formatDateTime(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTime.format(date)
}

/**
 * ISO8601 文字列を「08/27 09:10」の形に整形する。
 *
 * 年を落とす短い表記で、列幅の狭い一覧の「最終更新」向け（画面モックの残高マスタがこの形）。
 * 年まで要る画面は formatDateTime を使う。違いは見た目だけで、どちらを使うかは画面の指定で決まる。
 */
export function formatMonthDayTime(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  return monthDayTime.format(date)
}

/**
 * 「YYYYMMDD」の日付を「08/26」の形に整形する（CSV一括注文の有効期限・受注日）。
 *
 * CSV に書かれた値をそのまま受けるので、8 桁の数字でなければ受け取った値を返す
 * （検証で NG になった行でも、何が書いてあったかは見せる）。空なら '—'。
 */
export function formatCompactMonthDay(value) {
  if (!value) return '—'
  const match = /^\d{4}(\d{2})(\d{2})$/.exec(value)
  return match ? `${match[1]}/${match[2]}` : value
}

/**
 * 「HHMMSS」「HHMM」「HH:MM」「HH:MM:SS」の時刻を「09:01」の形に整形する（CSV一括注文の受注時刻）。
 * どれにも当たらなければ受け取った値を返す。空なら '—'。
 */
export function formatCompactTime(value) {
  if (!value) return '—'
  const match = /^(\d{2}):?(\d{2})(?::?\d{2})?$/.exec(value)
  return match ? `${match[1]}:${match[2]}` : value
}

/*
 * 全角空白。画面モックがコードと名称のあいだに置いている区切り。
 * ソースに直接書くと ESLint の no-irregular-whitespace に当たるので、コードポイントから作る。
 */
const WIDE_SPACE = String.fromCharCode(0x3000)

/**
 * 2 つの値を全角空白でつなぐ。ティッカーと銘柄名、口座番号と顧客名のように
 * 「コードと名称」を 1 セルに収める画面モックの体裁に合わせるためのもの。
 */
export function joinWide(left, right) {
  return `${left}${WIDE_SPACE}${right}`
}

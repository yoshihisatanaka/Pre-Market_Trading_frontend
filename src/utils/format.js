const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

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

/**
 * 米ドル建ての価格を表示用に整形する（`$1,234.56`）。
 * 通貨記号を前置する注文系の画面向け。単位を後置する画面は formatUsdUnit を使う。
 */
export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return usd.format(value)
}

/**
 * 米ドル建ての価格を「227.16 ドル」の形に整形する。
 *
 * 通貨記号で出す formatUsd との違いは見た目だけで、どちらを使うかは画面の指定で決まる。
 */
export function formatUsdUnit(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${usdDecimal.format(value)} ドル`
}

/**
 * 円建ての金額を「3,500,000 円」の形に整形する。
 *
 * 単位を後置する側の円版（formatUsdUnit と対になる）。マスタ系の一覧・編集で使う。
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

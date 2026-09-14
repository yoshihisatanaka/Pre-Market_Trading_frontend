const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const decimal = new Intl.NumberFormat('ja-JP')

// 米ドル建ての金額を「記号なし・小数 2 桁」で出すための書式（formatUsdAmount で使う）
const usdDecimal = new Intl.NumberFormat('en-US', {
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
 * 通貨記号を前置する注文系の画面向け。単位を後置する画面は formatUsdAmount を使う。
 */
export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return usd.format(value)
}

/**
 * 円建ての金額を表示用に整形する（`3,500,000 円`）。
 * 記号ではなく単位を後置する画面（マスタ系の一覧・編集）向け。
 */
export function formatJpyAmount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${decimal.format(value)} 円`
}

/**
 * 米ドル建ての金額を表示用に整形する（`50,000.00 ドル`）。
 * 記号ではなく単位を後置する画面向け。`$1,234.56` が要るときは formatUsd を使う。
 */
export function formatUsdAmount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${usdDecimal.format(value)} ドル`
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

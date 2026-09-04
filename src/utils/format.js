const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const decimal = new Intl.NumberFormat('ja-JP')

const dateTime = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** 米ドル建ての価格を表示用に整形する */
export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return usd.format(value)
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

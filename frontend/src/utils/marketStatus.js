/**
 * 米国市場の取引セッション判定（純関数）。
 * 区切りと表示文言は Manus モック（docs/mock/layout/masters-users.html）の updateMarketStatus に準拠する。
 *
 * モックは new Date(date.toLocaleString('en-US', { timeZone })) で再パースしているが、
 * 実行環境のロケール依存で壊れやすいため formatToParts で分解する。
 */

// hourCycle: 'h23' にしないと 0 時が "24" になる環境がある
const nyTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// 0:00 からの分で表した各セッションの範囲（開始以上・終了未満）
const SESSIONS = [
  { key: 'premarket', label: '● Pre-Market', from: 4 * 60, to: 9 * 60 + 30 },
  { key: 'regular', label: '● Regular', from: 9 * 60 + 30, to: 16 * 60 },
  { key: 'afterhours', label: '● After-Hours', from: 16 * 60, to: 20 * 60 },
]
const CLOSED = { key: 'closed', label: '○ Closed' }

/**
 * 与えた時刻のニューヨーク現地時刻を、0:00 からの分数で返す。
 * @param {Date} date
 * @returns {number}
 */
export function toNewYorkMinutes(date) {
  const parts = nyTimeFormat.formatToParts(date)
  const valueOf = (type) => Number(parts.find((part) => part.type === type).value)
  return valueOf('hour') * 60 + valueOf('minute')
}

/**
 * 取引セッションを判定する。
 * 休日・祝日は判定しない（モックと同じ挙動。docs/unit/utils-market-status.md の MKS-12 参照）。
 * @param {Date} [date] 省略時は現在時刻
 * @returns {{ key: 'premarket'|'regular'|'afterhours'|'closed', label: string }}
 */
export function getMarketStatus(date = new Date()) {
  const minutes = toNewYorkMinutes(date)
  const session = SESSIONS.find((s) => minutes >= s.from && minutes < s.to)
  return session ? { key: session.key, label: session.label } : { ...CLOSED }
}

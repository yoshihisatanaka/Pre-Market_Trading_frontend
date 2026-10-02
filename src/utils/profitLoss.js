import { formatJpyUnit } from './format'

/*
 * 評価損益の表示（符号付きの金額・率と、色分けの向き）。顧客詳細の預り一覧と顧客カードが使う。
 * 金額の書式は utils/format.js の「数字 + 半角スペース + 単位」に揃え、先頭に符号を付ける。
 * 正は '+'、負は '−'（U+2212。ハイフンより幅があり、桁の揃った列で読み違えにくい）。0 は符号なし。
 */

const MINUS = '−'

const percent = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function sign(value) {
  if (value > 0) return '+'
  if (value < 0) return MINUS
  return ''
}

/**
 * 符号付きの円（「+407,400 円」「−151,500 円」「0 円」）。値なしは '—'。
 *
 * @param {number|null|undefined} value
 */
export function formatSignedJpyUnit(value) {
  if (!isNumber(value)) return '—'
  return `${sign(value)}${formatJpyUnit(Math.abs(value))}`
}

/**
 * 符号付きの率（「+13.58%」「−4.59%」「0.00%」）。値は % の数値（13.58 なら 13.58%）。値なしは '—'。
 *
 * @param {number|null|undefined} value
 */
export function formatSignedPercent(value) {
  if (!isNumber(value)) return '—'
  return `${sign(value)}${percent.format(Math.abs(value))}%`
}

/**
 * 色分けの向き。画面はこれをクラス名（is-profit / is-loss）に使う。
 *
 * @param {number|null|undefined} value
 * @returns {'profit'|'loss'|''} 0 と値なしは ''（色を付けない）
 */
export function profitLossTone(value) {
  if (!isNumber(value) || value === 0) return ''
  return value > 0 ? 'profit' : 'loss'
}

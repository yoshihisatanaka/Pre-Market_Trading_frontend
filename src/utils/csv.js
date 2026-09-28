/**
 * CSV の組み立て（RFC 4180）。画面ごとの列や値の変換は持たない（それは呼び出し側）。
 *
 * 書式は別システム（TWS）に投入する CSV の実物に合わせてある:
 *   - 先頭に UTF-8 の BOM（Excel で開いたときに日本語が化けないため）
 *   - 改行は CRLF。最終行の後にも付ける
 *   - `,` `"` 改行を含む値は `"` で囲み、中の `"` は `""` に重ねる
 *   - null / undefined は空欄（0 や false は文字にして出す）
 */

const BOM = String.fromCharCode(0xfeff)
const CRLF = '\r\n'

/** 囲まないと区切りと見分けが付かなくなる文字 */
const NEEDS_QUOTE = /[",\r\n]/

/**
 * @param {string[]} header 1 行目の列名
 * @param {Array<Array<unknown>>} rows 2 行目以降。1 行 = 列の並びどおりの値の配列
 * @returns {string} BOM 付き・CRLF 区切りの CSV 本文
 */
export function buildCsv(header, rows) {
  return BOM + [header, ...rows].map((cells) => cells.map(toCell).join(',') + CRLF).join('')
}

function toCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return NEEDS_QUOTE.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

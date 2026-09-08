/**
 * URL クエリの値を扱う純関数。
 *
 * 一覧画面はページ位置と検索条件を URL クエリを正として持つ（`paramsFromQuery` / `queryFromParams`）。
 * クエリは手で書き換えられるため、値は必ずここを通してから store へ渡す。
 */

/**
 * URL クエリの `offset` を 0 以上の整数に変換する。
 *
 * 数値でない値・負の値・未指定は 0（1 ページ目の先頭）にする。
 * 表示件数の倍数への丸めはしない。`?offset=7` のような端数はそのまま通し、
 * その位置から表示件数分を表示する。
 *
 * @param {unknown} value `route.query.offset`
 * @returns {number} 0 以上の整数
 */
export function toOffset(value) {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

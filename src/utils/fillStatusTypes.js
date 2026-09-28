/**
 * 約定の出来状況（純関数と定数）。
 *
 * 画面モックの 3 区分（全部出来 / 一部出来 / 取消済（出来有））をアプリ内の値で持つ。
 * 実 API の 処理状況コード（011 / 010 / 032・034）との対応は api 層（src/api/mizuhoExecutions.js）が持ち、
 * ここはコードを知らない。検索セレクトの選択肢は、データが 1 件も無くても出せる必要があるので
 * 対応表をフロントに持つ（symbolTypes.js と同じ考えかた）。
 */

export const FILL_STATUS_OPTIONS = [
  { value: 'filled', label: '全部出来' },
  { value: 'partial', label: '一部出来' },
  { value: 'canceled_filled', label: '取消済（出来有）' },
]

/**
 * 出来状況の区分を表示名に変換する。
 *
 * @param {string} value 'filled' / 'partial' / 'canceled_filled'
 * @returns {string} 表示名。未知の値・空値は ''（呼び出し側がサーバの名称へ落とす）
 */
export function formatFillStatus(value) {
  return FILL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? ''
}

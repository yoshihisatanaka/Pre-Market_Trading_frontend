/**
 * 海外休場区分（純関数と定数）。
 *
 * バックエンドの `m_海外休場日.休場区分` は varchar(2) で '0' / '1' の 2 値。
 * 値は docs/api/openapi.json の HolidayTypeEnum を写した src/utils/apiEnums.js の
 * HOLIDAY_TYPE から取る（同じ値を 2 箇所に書かない）。**このファイルが足すのは表示名だけ。**
 * 一覧セル・検索セレクト・新規追加モーダルで共用する。
 *
 * 実 API は表示名も `休場区分名` として返すが、それは使わない。検索セレクトの選択肢は
 * データが 1 件も無くても出せる必要があり、対応表はフロントに持つほうが素直なため。
 *
 * 数値ではなく文字列で扱うのは、実 API の値がゼロ埋めされた文字列であることに合わせるため。
 */

import { HOLIDAY_TYPE } from './apiEnums'

/** 選択肢。BaseSelect の options にそのまま渡せる形にしておく */
export const MARKET_HOLIDAY_TYPE_OPTIONS = [
  { value: HOLIDAY_TYPE.ALL_DAY, label: '終日休場' },
  { value: HOLIDAY_TYPE.SHORTENED, label: '短縮取引' },
]

/** 既定値。m_海外休場日.休場区分 の DEFAULT '0' と同じ */
export const MARKET_HOLIDAY_TYPE_DEFAULT = HOLIDAY_TYPE.ALL_DAY

/**
 * 休場区分コードを表示名に変換する。
 *
 * @param {string} value 休場区分コード（'0' / '1'）
 * @returns {string} 表示名。未知の値・空値・未設定は '—'（他の列の空値表現とそろえる）
 */
export function formatMarketHolidayType(value) {
  const option = MARKET_HOLIDAY_TYPE_OPTIONS.find((candidate) => candidate.value === value)
  return option ? option.label : '—'
}

/**
 * 休場区分コードとして受け付けられる値かを判定する。
 * URL クエリのような外から来る値を検索条件に使う前に通す。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMarketHolidayType(value) {
  return MARKET_HOLIDAY_TYPE_OPTIONS.some((candidate) => candidate.value === value)
}

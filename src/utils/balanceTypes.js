/**
 * 口座区分（特定預り区分）の純関数と定数。
 *
 * 値は docs/api/openapi.json の `SpecificDepositEnum` を写した src/utils/apiEnums.js の
 * `SPECIFIC_DEPOSIT` から取る（同じ値を 2 箇所に書かない）。**このファイルが足すのは表示名だけ。**
 * 一覧セル・新規追加モーダルのプルダウンで共用する。
 *
 * 実 API は表示名も `特定預り区分名`（別名 `預り区分名`）として返すが、プルダウンの選択肢は
 * データが 1 件も無くても出せる必要があるので、対応表はフロントにも持つ。
 * 一覧セルはサーバが付けた名前を優先し、無いときだけこの対応表に落とす。
 *
 * **画面では「口座区分」と表示するが、m_口座情報 の `口座区分` とは別物。**
 * あちらはコードマスタ（GET /codes）の `口座区分`（一般 / 自己 / 同業者）で、
 * 顧客マスタの一覧に出ている列。残高マスタの見出しは画面モックの表記に合わせてあるので、
 * **同じ「口座区分」という語が 2 つの意味で使われている。**
 * 混ぜると事故るので、コード側の名前は API の項目名どおり
 * `specificDeposit` / `特定預り区分` のままにし、表示名だけを「口座区分」にしている。
 *
 * 数値ではなく文字列で扱うのは、実 API の値が文字列であることに合わせるため。
 */

import { SPECIFIC_DEPOSIT } from './apiEnums'

/** 選択肢。BaseSelect の options にそのまま渡せる形にしておく */
export const SPECIFIC_DEPOSIT_OPTIONS = [
  { value: SPECIFIC_DEPOSIT.NON_SPECIFIC, label: '非特定' },
  { value: SPECIFIC_DEPOSIT.SPECIFIC, label: '特定' },
  { value: SPECIFIC_DEPOSIT.NISA, label: 'NISA' },
  { value: SPECIFIC_DEPOSIT.GROWTH_QUOTA, label: '成長投資枠' },
  { value: SPECIFIC_DEPOSIT.CONTINUING_ACCOUNT, label: '継続管理勘定' },
]

/** 既定値。新規追加モーダルの初期選択（画面モックは「特定」が初期値） */
export const SPECIFIC_DEPOSIT_DEFAULT = SPECIFIC_DEPOSIT.SPECIFIC

/**
 * 口座区分コードを表示名に変換する。
 *
 * @param {string} value 口座区分コード（'0' / '1' / '4' / '6' / '8'）
 * @returns {string} 表示名。未知の値・空値・未設定は '—'（他の列の空値表現とそろえる）
 */
export function formatSpecificDeposit(value) {
  const option = SPECIFIC_DEPOSIT_OPTIONS.find((candidate) => candidate.value === value)
  return option ? option.label : '—'
}

/**
 * 口座区分コードとして受け付けられる値かを判定する。
 * URL クエリのような外から来る値を検索条件に使う前に通す。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSpecificDeposit(value) {
  return SPECIFIC_DEPOSIT_OPTIONS.some((candidate) => candidate.value === value)
}

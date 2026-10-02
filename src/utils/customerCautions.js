/*
 * 顧客の注意表示（コンプラランク・高齢者）の判定。画面モックの顧客カード・顧客バーが共通で使う規則。
 *   - コンプラランク A・B・Y・Z … 「要注意」
 *   - 85 歳以上 … 「高齢者」
 * 新規注文の顧客バー（components/orders/OrderCustomerBar.vue）と顧客詳細の顧客カード
 * （components/customers/CustomerInfoBar.vue）が同じ規則を使うので、ここに 1 つだけ置く。
 *
 * これは入力中・閲覧中に目に入れるための表示で、発注を止めるかはサーバ（POST /orders/validate）が決める。
 */

/** 「要注意」を出すコンプラランク（モックの compliance_rank in ['A','B','Y','Z']） */
export const CAUTION_RANKS = Object.freeze(['A', 'B', 'Y', 'Z'])

/** 高齢者として注意を出す年齢（モックの customer.age >= 85） */
export const ELDERLY_AGE = 85

/**
 * 年齢を数値で読む。実 API でも文字列で、法人は空。数字として読めるときだけ数値にする。
 *
 * @param {string|number|null|undefined} age src/api/customers.js の Customer の age
 * @returns {number|null}
 */
export function parseAge(age) {
  const value = String(age ?? '').trim()
  return /^\d+$/.test(value) ? Number(value) : null
}

/** @param {string|number|null|undefined} age */
export function isElderly(age) {
  const value = parseAge(age)
  return value !== null && value >= ELDERLY_AGE
}

/** @param {string|null|undefined} rank コンプラランクのコード（Customer の complianceRank） */
export function isCautionRank(rank) {
  return CAUTION_RANKS.includes(rank)
}

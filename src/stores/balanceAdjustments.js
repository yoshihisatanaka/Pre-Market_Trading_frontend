import { defineStore } from 'pinia'
import {
  createBalanceAdjustment,
  fetchBalanceAdjustments,
  updateBalanceAdjustment,
  updateBalanceSellProhibited,
} from '@/api/balanceAdjustments'
import { useCrudList } from '@/composables/useCrudList'

/** 一覧 1 ページあたりの表示件数 */
export const BALANCE_ADJUSTMENTS_PAGE_SIZE = 50

/**
 * 残高マスタのストア。
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・更新の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 *
 * 削除は画面モックに導線が無いので deleteItem を渡さない（remove / deleting は公開されない）。
 * 事前検証（`POST /masters/balance-adjustments/validate`）も同じ理由で使わないので
 * validateItem を渡さない。validationErrors は常に空配列のままになる。
 *
 * **性質の違う「2 段階」が 2 つあるので混同しないこと。**
 *   画面の 2 段階 … 入力 → 確認（モーダル内。view の step が持ち、サーバへは行かない）
 *   通信の 2 段階 … 事前検証 → 書き込み（useCrudList の validateItem。この画面では使わない）
 * 「内容を確認」は画面内の必須チェックだけで確認ステップへ進む。
 * 「補正を確定」で初めて create() / update() を呼ぶ。
 *
 * **create / update に渡す残高は補正後の絶対値。** 画面が入力させるのは「加算数量」だが、
 * 実 API に加算の概念は無いので、変換は view が行う（理由は src/api/balanceAdjustments.js）。
 *
 * **update は 2 つの口に振り分ける。** `sellProhibited` を持つ payload は売却可否の切り替え
 * （専用の `.../sell-prohibited`）、それ以外は数量の補正（部分更新の `PUT .../{id}`）。
 * どちらも useCrudList の update を通すので、競合防止・エラー表示・読み直しは共通のまま。
 */
export const useBalanceAdjustmentsStore = defineStore('balanceAdjustments', () =>
  useCrudList({
    pageSize: BALANCE_ADJUSTMENTS_PAGE_SIZE,
    filterKeys: ['branchCode', 'accountNumber', 'customerName', 'ticker', 'symbolName'],
    fetchPage: fetchBalanceAdjustments,
    createItem: createBalanceAdjustment,
    updateItem: updateBalanceAdjustmentOrSellProhibited,
  }),
)

/** update の payload を 2 つの口のどちらかへ振り分ける */
function updateBalanceAdjustmentOrSellProhibited(payload) {
  return payload.sellProhibited === undefined
    ? updateBalanceAdjustment(payload)
    : updateBalanceSellProhibited(payload)
}

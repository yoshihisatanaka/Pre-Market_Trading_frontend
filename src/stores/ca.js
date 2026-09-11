import { defineStore } from 'pinia'
import { fetchCorporateActions } from '@/api/ca'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API（`GET /ca`）の limit は既定 50・最大 200 で、こちらから指定できる。
 * ここを変えるとページャーの表示件数もそのまま変わる（api 層が limit として送る）。
 */
export const CA_PAGE_SIZE = 50

/**
 * CAマスタ（コーポレートアクション）のストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/ca.js の JSDoc を参照。
 *
 * **いまは読むだけの一覧**なので createItem / updateItem / deleteItem を渡さない。
 * useCrudList はそれらを渡さない限り登録・更新・削除の名前を公開しないので、
 * この段階では store.create() などは存在しない（追加・編集・削除は別途入れる）。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useCaStore = defineStore('ca', () =>
  useCrudList({
    pageSize: CA_PAGE_SIZE,
    filterKeys: ['stockCode', 'caType'],
    fetchPage: fetchCorporateActions,
  }),
)

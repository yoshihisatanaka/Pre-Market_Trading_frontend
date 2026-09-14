import { defineStore } from 'pinia'
import { fetchCustomers } from '@/api/customers'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API（`GET /customers`）は 1 ページ 50 件で固定されていて limit クエリを持たない。
 * ここを変えてもリクエストは変わらず、ページャーの表示だけがずれるので触らないこと。
 */
export const CUSTOMERS_PAGE_SIZE = 50

/**
 * 顧客マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/customers.js の JSDoc を参照。
 *
 * **いまは読むだけの一覧**なので createItem / updateItem / deleteItem を渡さない。
 * useCrudList はそれらを渡さない限り登録・更新・削除の名前を公開しないので、
 * この段階では store.create() などは存在しない（追加・編集・削除は別途入れる）。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useCustomersStore = defineStore('customers', () =>
  useCrudList({
    pageSize: CUSTOMERS_PAGE_SIZE,
    filterKeys: [
      'branchCode',
      'handlerCode',
      'accountNumber',
      'customerName',
      'restriction',
      'accountType',
      'corporateType',
    ],
    fetchPage: fetchCustomers,
  }),
)

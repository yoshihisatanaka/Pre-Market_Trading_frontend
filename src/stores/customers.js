import { defineStore } from 'pinia'
import {
  createCustomer,
  fetchCustomers,
  updateCustomer,
  validateCustomer,
} from '@/api/customers'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /masters/customers`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const CUSTOMERS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 顧客マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・更新の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/customers.js の JSDoc を参照。
 *
 * 登録・更新はどちらも「サーバの事前検証 → 本処理」の 2 段（validateItem を渡す）。
 * **削除は持たない**（2026-09-28 決定）ので deleteItem を渡さない。useCrudList は渡さない限り
 * remove / deleting を公開しないので、画面から誤って呼ぶこともできない。
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
    createItem: createCustomer,
    validateItem: validateCustomer,
    updateItem: updateCustomer,
  }),
)

import { defineStore } from 'pinia'
import { fetchOrderInquiry } from '@/api/orderInquiry'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 * 数えるのは注文の行で、画面の行（元注文ごとのまとまり）ではない（stores/orderInquiry.js と同じ）。
 */
export const CUSTOMER_ORDERS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 顧客詳細の注文照会タブ（/customers/:customerId/orders）のストア。
 *
 * 読む API は注文照会と同じ `fetchOrderInquiry`（`GET /orders`）で、部店コードと口座番号を
 * その顧客に固定して読む。固定の 2 つは画面が顧客カードの顧客から渡し、URL には載せない
 * （URL に載るのは銘柄コードと出来状況とページ位置だけ）。
 *
 * **ストアは注文照会（stores/orderInquiry.js）と分ける。** Pinia のインスタンスは全画面で共有なので、
 * 同じストアを使うと、こちらの読み込みが注文照会画面の検索条件とページ位置を踏み潰す。
 *
 * 一覧は読むだけ。訂正・取消は別画面（/orders/:orderId/amend・cancel）で行う。
 */
export const useCustomerOrdersStore = defineStore('customerOrders', () =>
  useCrudList({
    pageSize: CUSTOMER_ORDERS_PAGE_SIZE,
    filterKeys: ['branchCode', 'accountNumber', 'symbol', 'executionStatus'],
    fetchPage: fetchOrderInquiry,
  }),
)

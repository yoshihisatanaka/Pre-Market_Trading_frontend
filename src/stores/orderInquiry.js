import { defineStore } from 'pinia'
import { fetchOrderInquiry } from '@/api/orderInquiry'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /orders`）の limit は 1〜200。数えるのは注文の行で、画面の行（元注文ごとの
 * まとまり）ではない。この画面だけ変えるときはここを数値で上書きする。
 */
export const ORDER_INQUIRY_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 注文照会のストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/orderInquiry.js の JSDoc を参照。
 *
 * **いまは読むだけ。** 訂正・取消は別の API（`/orders/{order_id}/amend` / `cancel`）で、
 * 処理をつなぐときにここへ足す。
 */
export const useOrderInquiryStore = defineStore('orderInquiry', () =>
  useCrudList({
    pageSize: ORDER_INQUIRY_PAGE_SIZE,
    filterKeys: ['branchCode', 'accountNumber', 'symbol', 'executionStatus'],
    fetchPage: fetchOrderInquiry,
  }),
)

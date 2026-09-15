import { defineStore } from 'pinia'
import { fetchStocks } from '@/api/stocks'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API（`GET /stocks`）は 1 ページ 50 件で固定されていて `limit` クエリを持たない。
 * **こちらから変えられない値**なので、ここを変えてもサーバが返す件数は変わらず
 * ページャーの表示だけがずれる（api 層は limit を送らない）。
 */
export const STOCKS_PAGE_SIZE = 50

/**
 * 銘柄マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/stocks.js の JSDoc を参照。
 *
 * **いまは読むだけの一覧**なので createItem / updateItem / deleteItem を渡さない。
 * useCrudList はそれらを渡さない限り登録・更新・削除の名前を公開しないので、
 * この段階では store.create() などは存在しない（追加・編集・削除は別途入れる）。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useStocksStore = defineStore('stocks', () =>
  useCrudList({
    pageSize: STOCKS_PAGE_SIZE,
    filterKeys: ['stockCode', 'regulation', 'orderRoute', 'vwapTarget'],
    fetchPage: fetchStocks,
  }),
)

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchExecutions } from '@/api/executions'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /executions`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const EXECUTIONS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 約定照会のストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/executions.js の JSDoc を参照。
 *
 * **読むだけの一覧**なので createItem / updateItem / deleteItem を渡さない。
 *
 * useCrudList が公開しない「件数カードの集計（summary）」だけをここで足す。
 * 実 API は一覧と同じ応答で集計を返すので、別の取得は持たない。
 */
export const useExecutionsStore = defineStore('executions', () => {
  /** 最後に採用した応答の集計。まだ 1 度も取れていなければ null */
  const summary = ref(null)

  /*
   * useCrudList は古い応答を捨てるが、捨てた応答の集計までは面倒を見ない。
   * 同じ数え方（呼び出しごとに 1 つ進める合札）をここにも置き、最新の応答の集計だけを残す。
   * useCrudList は 1 回の load で fetchPage をちょうど 1 回呼ぶので、2 つの合札は常にそろう。
   */
  let latestToken = 0
  async function fetchPage(params) {
    const token = ++latestToken
    const page = await fetchExecutions(params)
    if (token === latestToken) summary.value = page.summary
    return page
  }

  const list = useCrudList({
    pageSize: EXECUTIONS_PAGE_SIZE,
    filterKeys: ['branchCode', 'symbol', 'side', 'status', 'dateFrom', 'dateTo', 'route'],
    fetchPage,
  })

  return { ...list, summary }
})

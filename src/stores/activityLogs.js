import { defineStore } from 'pinia'
import { fetchActivityLogs } from '@/api/activityLogs'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API（`GET /operations/activity-logs`）の limit は 1〜200 で既定 50。
 * ここの値が api 層から `limit` として送られるので、変えるとリクエストも変わる。
 */
export const ACTIVITY_LOGS_PAGE_SIZE = 50

/**
 * 操作ログのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/activityLogs.js の JSDoc を参照。
 *
 * **操作ログは読むだけ**なので createItem / updateItem / deleteItem は渡さない
 * （監査の記録なので、そもそも画面から書き換えられてはいけない）。
 *
 * 並べ替え（操作日時の降順）はサーバの責務で、ここでは触らない。
 */
export const useActivityLogsStore = defineStore('activityLogs', () =>
  useCrudList({
    pageSize: ACTIVITY_LOGS_PAGE_SIZE,
    filterKeys: [
      'dateFrom',
      'dateTo',
      'actorCode',
      'category',
      'feature',
      'action',
      'actorGroup',
      'result',
      'keyword',
    ],
    fetchPage: fetchActivityLogs,
  }),
)

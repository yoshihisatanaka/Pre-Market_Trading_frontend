import { defineStore } from 'pinia'
import { fetchActivityLogs } from '@/api/activityLogs'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /operations/activity-logs`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const ACTIVITY_LOGS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 操作ログのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/activityLogs.js の JSDoc を参照。
 *
 * **操作ログは読むだけ**なので createItem / updateItem / deleteItem は渡さない
 * （監査の記録なので、そもそも画面から書き換えられてはいけない）。
 */
export const useActivityLogsStore = defineStore('activityLogs', () =>
  useCrudList({
    pageSize: ACTIVITY_LOGS_PAGE_SIZE,
    // sort も検索条件と同じく URL クエリが正（並び替えはサーバの責務で、ここでは触らない）
    filterKeys: ['dateFrom', 'dateTo', 'operator', 'operation', 'targetType', 'targetKey', 'sort'],
    fetchPage: fetchActivityLogs,
  }),
)

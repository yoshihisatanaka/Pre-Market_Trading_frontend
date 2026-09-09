import { defineStore } from 'pinia'
import { createMarketHoliday, deleteMarketHoliday, fetchMarketHolidays } from '@/api/marketHolidays'
import { useCrudList } from '@/composables/useCrudList'

/** 一覧 1 ページあたりの表示件数 */
export const MARKET_HOLIDAYS_PAGE_SIZE = 50

/**
 * 海外休場日マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・削除の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/marketHolidays.js の JSDoc を参照。
 *
 * この API には登録前の事前検証が無いので validateItem は渡さない
 * （そのため validationErrors は常に空配列で、画面側では使わない）。
 */
export const useMarketHolidaysStore = defineStore('marketHolidays', () =>
  useCrudList({
    pageSize: MARKET_HOLIDAYS_PAGE_SIZE,
    filterKeys: ['dateFrom', 'dateTo', 'holidayType'],
    fetchPage: fetchMarketHolidays,
    createItem: createMarketHoliday,
    deleteItem: deleteMarketHoliday,
  }),
)

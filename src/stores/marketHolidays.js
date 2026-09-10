import { defineStore } from 'pinia'
import {
  createMarketHoliday,
  deleteMarketHoliday,
  fetchMarketHolidays,
  validateMarketHoliday,
} from '@/api/marketHolidays'
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
 * 登録は事前検証（POST /holidays/validate）を通してから行う。日付の実在性・重複・
 * 取消済み日付の再有効化はサーバだけが判断できるので、その理由と警告を
 * validationErrors / validationWarnings で受け取る。
 *
 * 行ごとの編集はまだ持たないので updateItem は渡さない。
 */
export const useMarketHolidaysStore = defineStore('marketHolidays', () =>
  useCrudList({
    pageSize: MARKET_HOLIDAYS_PAGE_SIZE,
    filterKeys: ['dateFrom', 'dateTo', 'holidayType'],
    fetchPage: fetchMarketHolidays,
    createItem: createMarketHoliday,
    validateItem: validateMarketHoliday,
    deleteItem: deleteMarketHoliday,
  }),
)

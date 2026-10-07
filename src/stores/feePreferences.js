import { defineStore } from 'pinia'
import {
  createFeePreference,
  deleteFeePreference,
  fetchFeePreferences,
  updateFeePreference,
  validateFeePreference,
} from '@/api/feePreferences'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /masters/fee-preferences`）の limit は 1〜200 で、こちらから指定できる。
 */
export const FEE_PREFERENCES_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 手数料優遇マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/feePreferences.js の JSDoc を参照。
 *
 * 登録も変更も「サーバの事前検証（validateItem）→ 登録・変更」の 2 段。
 * 不合格は validationErrors / updateValidationErrors、通信・サーバ障害は createError / updateError。
 * 事前検証の警告（未登録の手数料パターンなど）は登録側だけが validationWarnings で止まる
 * （変更側は止まらず、PUT の応答の warnings を画面が成功の通知に添える）。
 *
 * 削除は 1 段（DELETE は本文を取らず、楽観的ロックも無い）。拒否の理由はすべて deleteError に入る。
 */
export const useFeePreferencesStore = defineStore('feePreferences', () => {
  return useCrudList({
    pageSize: FEE_PREFERENCES_PAGE_SIZE,
    filterKeys: ['branchCode', 'accountNumber', 'feePattern'],
    fetchPage: fetchFeePreferences,
    createItem: createFeePreference,
    validateItem: validateFeePreference,
    updateItem: updateFeePreference,
    deleteItem: deleteFeePreference,
  })
})

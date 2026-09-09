import { defineStore } from 'pinia'
import {
  createBlockedDate,
  deleteBlockedDate,
  fetchBlockedDates,
  validateBlockedDate,
} from '@/api/blockedDates'
import { useCrudList } from '@/composables/useCrudList'

/** 一覧 1 ページあたりの表示件数 */
export const BLOCKED_DATES_PAGE_SIZE = 50

/**
 * 受注不可日マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・削除の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/blockedDates.js の JSDoc を参照。
 *
 * 登録は「事前検証 → 登録」の 2 段（API 側がその前提で分かれている）。検証の不合格は
 * 例外ではなく validationErrors に入り、通信・サーバ障害だけが createError に入る。
 *
 * 編集は別コミットで足すので、いまは一覧の取得・新規追加・削除だけを持つ。
 */
export const useBlockedDatesStore = defineStore('blockedDates', () =>
  useCrudList({
    pageSize: BLOCKED_DATES_PAGE_SIZE,
    filterKeys: ['dateFrom', 'dateTo'],
    fetchPage: fetchBlockedDates,
    createItem: createBlockedDate,
    validateItem: validateBlockedDate,
    deleteItem: deleteBlockedDate,
  }),
)

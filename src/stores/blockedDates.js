import { defineStore } from 'pinia'
import {
  createBlockedDate,
  deleteBlockedDate,
  fetchBlockedDates,
  updateBlockedDate,
  validateBlockedDate,
} from '@/api/blockedDates'
import { useCrudList } from '@/composables/useCrudList'

/** 一覧 1 ページあたりの表示件数 */
export const BLOCKED_DATES_PAGE_SIZE = 50

/**
 * 受注不可日マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・更新・削除の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/blockedDates.js の JSDoc を参照。
 *
 * 登録も編集も「事前検証 → 登録 / 更新」の 2 段（API 側がその前提で分かれている）。検証の不合格は
 * 例外ではなく validationErrors / updateValidationErrors に入り、通信・サーバ障害だけが
 * createError / updateError に入る。
 *
 * 編集は日付と理由の両方を変更でき、更新は一覧取得時の更新日時を送り返す楽観的ロック付き。
 * 競合（409）は通信・サーバ障害と同じ updateError に入る（画面は 409 を特別扱いしない）。
 */
export const useBlockedDatesStore = defineStore('blockedDates', () =>
  useCrudList({
    pageSize: BLOCKED_DATES_PAGE_SIZE,
    filterKeys: ['dateFrom', 'dateTo'],
    fetchPage: fetchBlockedDates,
    createItem: createBlockedDate,
    validateItem: validateBlockedDate,
    updateItem: updateBlockedDate,
    deleteItem: deleteBlockedDate,
  }),
)

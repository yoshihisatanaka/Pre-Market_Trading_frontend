import { defineStore } from 'pinia'
import {
  createBlackoutDate,
  deleteBlackoutDate,
  fetchBlackoutDates,
  updateBlackoutDate,
  validateBlackoutDate,
} from '@/api/blackoutDates'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API 側の 1 ページ 50 件に合わせた値で、**勝手に変えられない**。
 * `GET /blackout-dates` は limit というクエリを持たず 50 件で固定されているため、
 * ここを別の値にするとページャーの見た目と実際の返却件数がずれる。
 */
export const BLACKOUT_DATES_PAGE_SIZE = 50

/**
 * 受注不可日マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・更新・削除の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/blackoutDates.js の JSDoc を参照。
 *
 * 登録も編集も「事前検証 → 登録 / 更新」の 2 段（実 API がその前提で分かれている）。検証の不合格は
 * 例外ではなく validationErrors / updateValidationErrors に入り、通信・サーバ障害だけが
 * createError / updateError に入る。
 *
 * 海外休場日と違い validationWarnings は使わない。実 API の事前検証が warnings を返さず、
 * 取消済みの日付を登録し直しても黙って再有効化されるため（useCrudList 側の名前は公開されるが常に空）。
 *
 * 編集は日付と理由の両方を変更でき、更新は一覧取得時の更新日時を送り返す楽観的ロック付き。
 * 競合（409）は通信・サーバ障害と同じ updateError に入る（画面は 409 を特別扱いしない）。
 *
 * 一覧は実 API と同じ**受注不可日の降順**で返る（並べ替えはサーバの責務。ここでは触らない）。
 */
export const useBlackoutDatesStore = defineStore('blackoutDates', () =>
  useCrudList({
    pageSize: BLACKOUT_DATES_PAGE_SIZE,
    filterKeys: ['dateFrom', 'dateTo'],
    fetchPage: fetchBlackoutDates,
    createItem: createBlackoutDate,
    validateItem: validateBlackoutDate,
    updateItem: updateBlackoutDate,
    deleteItem: deleteBlackoutDate,
  }),
)

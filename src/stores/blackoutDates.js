import { defineStore } from 'pinia'
import {
  createBlackoutDate,
  deleteBlackoutDate,
  fetchBlackoutDates,
  updateBlackoutDate,
  validateBlackoutDate,
} from '@/api/blackoutDates'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'
import { reloadMarketStatusAfter } from './marketStatus'

/**
 * 一覧 1 ページあたりの表示件数。api 層が limit として送る。
 *
 * 既定は utils/pagination.js の DEFAULT_PAGE_SIZE。この画面だけ変えるときは数値で上書きする
 * （以前は実 API が limit を持たず 50 件固定だったが、#21 で limit が入った）。
 */
export const BLACKOUT_DATES_PAGE_SIZE = DEFAULT_PAGE_SIZE

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
 *
 * 登録・更新・削除が成功したら市場状況（ヘッダ）を取り直す。当日を受注不可にしたときに、
 * 起動時に取った市場日時と表示が食い違わないようにするため（stores/marketStatus.js）。
 */
export const useBlackoutDatesStore = defineStore('blackoutDates', () =>
  useCrudList({
    pageSize: BLACKOUT_DATES_PAGE_SIZE,
    filterKeys: ['date'],
    fetchPage: fetchBlackoutDates,
    createItem: reloadMarketStatusAfter(createBlackoutDate),
    validateItem: validateBlackoutDate,
    updateItem: reloadMarketStatusAfter(updateBlackoutDate),
    deleteItem: reloadMarketStatusAfter(deleteBlackoutDate),
  }),
)

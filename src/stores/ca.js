import { defineStore } from 'pinia'
import {
  createCorporateAction,
  deleteCorporateAction,
  fetchCorporateActions,
  updateCorporateAction,
  validateCorporateAction,
} from '@/api/ca'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API（`GET /ca`）の limit は既定 50・最大 200 で、こちらから指定できる。
 * ここを変えるとページャーの表示件数もそのまま変わる（api 層が limit として送る）。
 */
export const CA_PAGE_SIZE = 50

/**
 * CAマスタ（コーポレートアクション）のストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止・登録・更新・削除の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/ca.js の JSDoc を参照。
 *
 * 登録も編集も「事前検証 → 登録 / 更新」の 2 段（実 API がその前提で分かれている）。
 * 検証の不合格は例外ではなく validationErrors / updateValidationErrors に入り、
 * 通信・サーバ障害だけが createError / updateError に入る。
 *
 * 編集は全項目を変更でき（CARequest がレコード全体を差し替える形なので）、更新は一覧取得時の
 * 更新日時を送り返す楽観的ロック付き。競合（409）は通信・サーバ障害と同じ updateError に入る
 * （画面は 409 を特別扱いしない）。
 *
 * **`validationWarnings` は公開されるが常に空。** api 層の validateCorporateAction が
 * warnings を受け取らないため（理由はそちらの JSDoc。CA は主キーが surrogate な ID で、
 * 登録が必ず新しい行を作るので「取消済みの行を再有効化する」ような確認事項が起きない）。
 *
 * 削除は実 API 側が論理削除（取消区分=1）。一覧は既定で取消済みを返さないので、
 * 読み直すと消えたように見える。事前検証は無い（DELETE は本文を取らない）。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useCaStore = defineStore('ca', () =>
  useCrudList({
    pageSize: CA_PAGE_SIZE,
    filterKeys: ['stockCode', 'caType'],
    fetchPage: fetchCorporateActions,
    createItem: createCorporateAction,
    validateItem: validateCorporateAction,
    updateItem: updateCorporateAction,
    deleteItem: deleteCorporateAction,
  }),
)

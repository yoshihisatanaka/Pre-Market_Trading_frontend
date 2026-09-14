import { defineStore } from 'pinia'
import { createCorporateAction, fetchCorporateActions, validateCorporateAction } from '@/api/ca'
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
 * 取得・競合防止・登録の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/ca.js の JSDoc を参照。
 *
 * 登録は「事前検証 → 登録」の 2 段（実 API がその前提で分かれている）。検証の不合格は
 * 例外ではなく validationErrors に入り、通信・サーバ障害だけが createError に入る。
 *
 * **`validationWarnings` は公開されるが常に空。** api 層の validateCorporateAction が
 * warnings を受け取らないため（理由はそちらの JSDoc。CA は主キーが surrogate な ID で、
 * 登録が必ず新しい行を作るので「取消済みの行を再有効化する」ような確認事項が起きない）。
 *
 * **編集と削除はまだ無い**ので updateItem / deleteItem を渡さない。
 * useCrudList はそれらを渡さない限り更新・削除の名前を公開しないので、
 * この段階では store.update() / store.remove() は存在しない（別途入れる）。
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
  }),
)

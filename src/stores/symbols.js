import { defineStore } from 'pinia'
import {
  createSymbol,
  deleteSymbol,
  fetchSymbols,
  updateSymbol,
  validateSymbol,
} from '@/api/symbols'
import { useCrudList } from '@/composables/useCrudList'

/**
 * 一覧 1 ページあたりの表示件数。
 *
 * 実 API（`GET /masters/symbols`）の limit は既定 50・最大 200 で、こちらから指定できる。
 * ここを変えるとページャーの表示件数もそのまま変わる（api 層が limit として送る）。
 */
export const SYMBOLS_PAGE_SIZE = 50

/**
 * 銘柄マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/symbols.js の JSDoc を参照。
 *
 * **取得・登録・更新・削除の CRUD 一式を持つ。**
 *
 * 登録も編集も「サーバの事前検証（validateItem）→ 登録・更新」の 2 段。
 * 不合格は validationErrors / updateValidationErrors、通信・サーバ障害は
 * createError / updateError と、入れ物が 4 つに分かれる。楽観的ロックの競合（409）は
 * 事前検証の不合格ではなく updateError に入る。
 *
 * **削除だけは 1 段。** 実 API の DELETE は本文を取らないので事前検証を通さず、
 * 楽観的ロックも無い（競合の 409 が起きない）。拒否の理由はすべて deleteError に入る。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useSymbolsStore = defineStore('symbols', () =>
  useCrudList({
    pageSize: SYMBOLS_PAGE_SIZE,
    filterKeys: ['symbolCode', 'regulation', 'orderRoute', 'vwapTarget'],
    fetchPage: fetchSymbols,
    createItem: createSymbol,
    validateItem: validateSymbol,
    updateItem: updateSymbol,
    deleteItem: deleteSymbol,
  }),
)

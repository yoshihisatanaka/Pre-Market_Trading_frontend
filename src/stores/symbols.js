import { defineStore } from 'pinia'
import { createSymbol, fetchSymbols, validateSymbol } from '@/api/symbols'
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
 * **いまは一覧と新規追加まで。** updateItem / deleteItem を渡していないので、
 * useCrudList は更新・削除の名前を公開しない（store.update() などは存在しない）。
 * 編集・削除は別途入れる。
 *
 * 登録は「サーバの事前検証（validateItem）→ 登録（createItem）」の 2 段。
 * 不合格は validationErrors、通信・サーバ障害は createError と、入れ物が分かれる。
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
  }),
)

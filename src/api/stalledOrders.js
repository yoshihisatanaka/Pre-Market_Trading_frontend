import { apiClient } from './client'

/*
 * 滞留注文抽出（`/operations/stalled-orders`）。
 *
 * ブローカー・自システムの障害で発注できなかった注文（注文エラー）と、別システムで
 * 発注しコンファメーションを取り込んだあと未約定のままの注文（注文中）を同時に返す。
 *
 * **この API はバックエンド未実装。** openapi.json に該当パスが無いため、形は実 API の
 * `OrderItemResponse` に寄せた仮置きで、モック（src/mocks/）だけが応答する。
 * 仕様が来たらこの層の変換だけを直せば、ストアと画面は無変更で済む。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - プロパティ名が日本語（ID / 部店 / 口座番号 / 銘柄コード / 売買区分 …）
 *   - 売買区分は '1'（買）/ '3'（売）。アプリ内は 'buy' / 'sell'
 *   - 受注日と受注時刻が別項目。アプリ内は 1 本の日時文字列
 *   - 市場区分と出来状況は名前（発注範囲名 / 処理状況名）をサーバが付けて返す
 */

/**
 * 1 件のアプリ内モデル。
 *
 * @typedef {{
 *   id: string, branchCode: string, accountNumber: string, customerName: string,
 *   symbol: string, side: 'buy'|'sell'|'', quantity: number|null,
 *   orderType: string, limitPrice: number|null, marketCategoryName: string,
 *   orderedAt: string, statusName: string, errorReason: string, confirmationNote: string,
 * }} StalledOrder
 *   orderType は 'LO'（指値）/ 'MO'（成行）。limitPrice は成行のとき null。
 *   errorReason は注文エラーの行だけ、confirmationNote は注文中の行だけ埋まる。
 */

/** 売買区分（SideEnum）→ アプリ内の向き */
const SIDES = { 1: 'buy', 3: 'sell' }

/**
 * 滞留中の注文を取得する。
 *
 * ページャを持たない一覧なので `{ items, total }` ではなく、2 本の配列を返す
 * （画面が「注文エラー」と「注文中」を別のカードに並べるため）。
 *
 * @param {{ branchCode?: string, accountNumber?: string, symbol?: string }} [params]
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ orderErrors: StalledOrder[], workingOrders: StalledOrder[] }>}
 */
export async function fetchStalledOrders({
  branchCode = '',
  accountNumber = '',
  symbol = '',
} = {}) {
  const { data } = await apiClient.get('/operations/stalled-orders', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      branch_code: branchCode || undefined,
      account_no: accountNumber || undefined,
      symbol: symbol || undefined,
    },
  })

  return {
    orderErrors: (data?.order_errors ?? []).map(toStalledOrder),
    workingOrders: (data?.working_orders ?? []).map(toStalledOrder),
  }
}

function toStalledOrder(raw) {
  return {
    id: String(raw?.ID ?? ''),
    branchCode: raw?.部店 ?? '',
    // 口座番号は integer で来るが、画面は桁を揃えて出すだけなので文字列に寄せる
    accountNumber: raw?.口座番号 == null ? '' : String(raw.口座番号),
    customerName: raw?.顧客名 ?? '',
    symbol: raw?.銘柄コード ?? '',
    // 知らないコードは空にする。'1'/'3' 以外を 'buy' に丸めると買いと売りを取り違える
    side: SIDES[raw?.売買区分] ?? '',
    quantity: toNumberOrNull(raw?.数量),
    orderType: raw?.指成区分 ?? '',
    /*
     * 指値単価だけは null のまま通す。成行注文は値を持たないので、0 に寄せると
     * 「0 ドルの指値」と見分けが付かなくなる（画面は orderType を見て「成行」と出す）。
     */
    limitPrice: toNumberOrNull(raw?.指値単価),
    marketCategoryName: raw?.発注範囲名 ?? '',
    orderedAt: toOrderedAt(raw?.受注日, raw?.受注時刻),
    statusName: raw?.処理状況名 ?? '',
    errorReason: raw?.エラー内容 ?? '',
    confirmationNote: raw?.確認状況 ?? '',
  }
}

/**
 * 別項目で来る受注日と受注時刻を 1 本の日時にまとめる（'2026-09-16T10:22:00'）。
 * どちらかが欠けていたら空文字にして、画面側の整形に '—' を出させる。
 */
function toOrderedAt(date, time) {
  if (!date || !time) return ''
  return `${date}T${time}`
}

function toNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

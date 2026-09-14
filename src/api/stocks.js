import { apiClient } from './client'

/*
 * 銘柄マスタ（実 API `/stocks`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 6 点。
 *   - プロパティ名が日本語（銘柄コード / Ticker / 銘柄名_英字 / 前日終値 …）
 *   - 検索クエリ名も日本語（`銘柄コード` / `規制情報` / `注文ルート` / `VWAP対象区分`）。
 *     axios が URL エンコードして送る
 *   - フラグが 0 / 1 の integer（取消区分・ユーザー操作フラグ）。アプリ内は boolean
 *   - 一覧の配列名が `stocks`
 *   - 一覧は 1 ページ 50 件固定で `limit` クエリを持たない（応答の limit は常に 50）
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *
 * 画面の検索欄（銘柄コード・ティッカーコード）は `銘柄コード` パラメータにだけ乗る。
 * 実 API は `銘柄コード` / `Ticker` / `銘柄名` / `銘柄名_英字` をそれぞれ別のパラメータに
 * 分けていて、まとめて 1 語で探すパラメータが無いため、**この欄では銘柄名では絞れない**。
 *
 * いまは一覧の取得だけを持つ。登録・更新・削除、CSV 入出力、更新履歴は別途。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   stockCode: string,
 *   ticker: string,
 *   name: string,
 *   nameEn: string,
 *   marketName: string,
 *   regulation: string,
 *   regulationName: string,
 *   orderRoute: string,
 *   orderRouteName: string,
 *   vwapTarget: string,
 *   vwapTargetName: string,
 *   note: string,
 *   previousClose: number|null,
 *   previousVolume: number|null,
 *   averageVolume: number|null,
 *   userModified: boolean,
 * }} Stock
 *   stockCode が主キー（実 API も銘柄コードをキーにしている）。
 *   数値 3 種は null のまま通す。0 と「未取得」を区別したいので空文字や 0 に寄せない
 *   （整形は utils/format.js の formatUsd / formatQuantity が null を '—' にする）。
 *   userModified は ユーザー操作フラグ=1（手動操作された行）。一覧で色を付ける印になる
 */

/**
 * 銘柄の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * `limit` は受け取っても送らない。実 API の一覧は 1 ページ 50 件で固定されており
 * `limit` というクエリを持たない。ページャーの表示件数は
 * stores/stocks.js の STOCKS_PAGE_SIZE 側で 50 に合わせてある。
 *
 * @param {{
 *   offset?: number,
 *   stockCode?: string,
 *   regulation?: string,
 *   orderRoute?: string,
 *   vwapTarget?: string,
 * }} [params]
 *   stockCode は銘柄コードまたは Ticker。regulation / orderRoute / vwapTarget は
 *   utils/stockTypes.js のコード値。空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: Stock[], total: number }>}
 */
export async function fetchStocks({
  offset = 0,
  stockCode = '',
  regulation = '',
  orderRoute = '',
  vwapTarget = '',
} = {}) {
  const { data } = await apiClient.get('/stocks', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      offset,
      銘柄コード: stockCode || undefined,
      規制情報: regulation || undefined,
      注文ルート: orderRoute || undefined,
      VWAP対象区分: vwapTarget || undefined,
    },
  })

  return {
    items: (data.stocks ?? []).map(toStock),
    total: data.total ?? 0,
  }
}

/** StockItem → アプリ内モデル */
function toStock(raw) {
  return {
    // 主キーは銘柄コードそのもの（CA のような数値 ID は無い）
    stockCode: raw?.銘柄コード ?? '',
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    ticker: raw?.Ticker ?? '',
    name: raw?.銘柄名 ?? '',
    nameEn: raw?.銘柄名_英字 ?? '',
    marketName: raw?.市場名 ?? '',
    regulation: raw?.規制情報 ?? '',
    // 表示名はサーバが付けて返す。欠けているときは画面側がコードから補う
    regulationName: raw?.規制情報名 ?? '',
    orderRoute: raw?.注文ルート ?? '',
    orderRouteName: raw?.注文ルート名 ?? '',
    vwapTarget: raw?.VWAP対象区分 ?? '',
    vwapTargetName: raw?.VWAP対象区分名 ?? '',
    note: raw?.備考 ?? '',
    /*
     * 相場の数値だけは null のまま通す。「0 株」と「まだ取れていない」は別の意味で、
     * 空文字や 0 に寄せると一覧でその区別が消える（整形側が null を '—' にする）。
     */
    previousClose: toNumberOrNull(raw?.前日終値),
    previousVolume: toNumberOrNull(raw?.前日出来高),
    averageVolume: toNumberOrNull(raw?.平均出来高),
    // 0 / 1 の integer は、この層で boolean に直して外へ出す
    userModified: raw?.ユーザー操作フラグ === 1,
  }
}

/**
 * 数値に寄せる。数値にならないもの（null / undefined / 空文字 / 文字列）は null。
 *
 * 実 API は number / integer を返す約束だが、未取得を null で表す項目なので
 * 「数値でなければ未取得」として扱う。
 */
function toNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

import { apiClient } from './client'

/*
 * CAマスタ（コーポレートアクション。実 API `/ca`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - プロパティ名が日本語（ID / 銘柄コード / CA種別 / 権利付最終日 …）
 *   - 日付は integer の YYYYMMDD（20260901）。アプリ内は 'YYYY-MM-DD'
 *   - フラグが 0 / 1 の integer（取消区分・ユーザー操作フラグ）。アプリ内は boolean
 *   - 一覧の配列名が `ca_list`
 *   - 削除は論理削除（取消区分=1）。一覧は既定で取消済みを返さない
 *
 * いまは一覧の取得だけを持つ。登録・更新・削除、CSV 入出力、更新履歴は別途。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
 *   stockCode: string,
 *   ticker: string,
 *   caType: string,
 *   caTypeName: string,
 *   exRightsDate: string,
 *   effectiveDate: string,
 *   paymentDate: string,
 *   ratio: string,
 *   note: string,
 *   userModified: boolean,
 * }} CorporateAction
 *   id は実 API の ID を文字列にしたもの。日付 3 種は 'YYYY-MM-DD'（未設定は空文字）。
 *   userModified は ユーザー操作フラグ=1（手動操作された行）。一覧で色を付ける印になる
 */

/**
 * CA の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 取消済み（論理削除）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * @param {{ limit?: number, offset?: number, stockCode?: string, caType?: string }} [params]
 *   stockCode は銘柄コードまたは Ticker。caType は CA種別コード（'110' など）。
 *   空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: CorporateAction[], total: number }>}
 */
export async function fetchCorporateActions({
  limit = 50,
  offset = 0,
  stockCode = '',
  caType = '',
} = {}) {
  const { data } = await apiClient.get('/ca', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      stock_code: stockCode || undefined,
      ca_type: caType || undefined,
    },
  })

  return {
    items: (data.ca_list ?? []).map(toCorporateAction),
    total: data.total ?? 0,
  }
}

/** CAItem → アプリ内モデル */
function toCorporateAction(raw) {
  return {
    // 実 API の主キーは integer の ID。画面と URL では文字列として扱う
    id: String(raw?.ID ?? ''),
    stockCode: raw?.銘柄コード ?? '',
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    ticker: raw?.Ticker ?? '',
    caType: raw?.CA種別 ?? '',
    // 表示名はサーバが付けて返す。欠けているときは画面側が CA種別コードから補う
    caTypeName: raw?.CA種別名 ?? '',
    exRightsDate: toIsoDate(raw?.権利付最終日),
    effectiveDate: toIsoDate(raw?.効力発生日),
    paymentDate: toIsoDate(raw?.支払日),
    // 比率は「1:2」のような表示用の文字列でサーバが算出する（分母・分子はここでは使わない）
    ratio: raw?.比率 ?? '',
    note: raw?.備考 ?? '',
    // 0 / 1 の integer は、この層で boolean に直して外へ出す
    userModified: raw?.ユーザー操作フラグ === 1,
  }
}

/**
 * 20260901 → '2026-09-01'。
 *
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

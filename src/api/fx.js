import { apiClient } from './client'

/*
 * 為替（実 API `/masters/fx`）。いまは新規注文の概算金額に使う直近レートだけを読む。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり。
 *   - プロパティ名が日本語（基準日 / 通貨コード / 為替レート）
 *   - 基準日 は YYYYMMDD の integer。アプリ内は 'YYYY-MM-DD'
 * 有効なレートが無いと実 API は 404 を返す（ApiError として throw される）。
 *
 * **並行ブランチ feat/fx-master-view が src/api/fxRates.js に同名の fetchLatestFxRate を作っている**
 * （2026-09-29 時点で未マージ）。あちらが先に main に入ったら、このファイルと
 * src/mocks/handlers/fx.js・src/mocks/fixtures/fx.js を消して stores/orderEntry.js の import を
 * `@/api/fxRates` に張り替える（戻り値の `rate` を読むだけなので形の差は無い。404 は null になる）。
 */

/**
 * 直近の為替レートを取得する。
 *
 * target_date は送らない（省略すると実 API は今日を基準にする）。
 *
 * @param {{ currencyCode?: string }} [params] 通貨コード（既定 USD）
 * @returns {Promise<{ rate: number|null, baseDate: string, currencyCode: string }>}
 *   rate は 1 通貨あたりの円。応答に数値が無ければ null（概算を「—」にする）
 */
export async function fetchLatestFxRate({ currencyCode = 'USD' } = {}) {
  const { data } = await apiClient.get('/masters/fx/latest', {
    // クエリ名を知ってよいのはこの層だけ
    params: { currency_code: currencyCode },
  })

  const rate = Number(data?.為替レート)
  return {
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    baseDate: toIsoDate(data?.基準日),
    currencyCode: data?.通貨コード ?? currencyCode,
  }
}

/** YYYYMMDD の integer → 'YYYY-MM-DD'（不正な値は ''） */
function toIsoDate(value) {
  const text = String(value ?? '')
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : ''
}

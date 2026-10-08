import { apiClient } from './client'

/*
 * 預り残高の検索（実 API `GET /holdings`。m_残高情報 に口座・銘柄・為替・CA を結合した明細）。
 *
 * 顧客詳細の外株預り（/customers/:customerId/summary）が 1 顧客ぶんを読む。
 * 預り検索（/customers/holdings。stores/holdingSearch.js）は同じ関数で顧客横断に読む。
 * 項目の意味は docs/api/requests.md #36 の回答（2026-10-06、Phase 66）で確定した。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり。
 *   - プロパティ名が日本語（口座番号 / 銘柄コード / 評価額_JPY …）
 *   - クエリ名は英語の snake_case（branch_code / account_no / symbol / symbol_name / specific_deposit）
 *   - 口座番号は integer で、クエリ名は `account_no`。アプリ内は文字列
 *   - 行 ID（m_残高情報.ID）と 口座ID（m_口座情報.ID。顧客詳細のパスキー）は integer。アプリ内は文字列
 *   - 売却不可区分は 0 / 1 の integer。アプリ内は boolean
 *   - 評価損益率は「% 表記」の文字列（'+12.34%' / '-5.20%'）。アプリ内は数値（12.34 なら 12.34%）
 *   - `預り売買区分` は名前に反して**特定預り区分のコード**（0 一般 / 1 特定 / 4 NISA / 6 成長投資枠 /
 *     8 継続管理勘定。HoldingItem の説明「注文の預り売買区分とはコードの意味が逆」）。注文の 預り売買区分
 *     （0 特定 / 1 一般 / 6 成長投資枠）とは向きが違うので、注文へ渡すときは
 *     src/utils/orderEntryQuery.js の toDepositCategory で読み替える
 *   - 金額の単位: 前日終値・平均取得単価・評価額_USD は USD、取得金額・評価額_JPY・評価損益は円
 *
 * 項目が無い応答（Phase 66 より前のバックエンド）にも落ちずに読めるようにしてある:
 *   - ID が無ければ 口座番号・銘柄コード・預り売買区分 を ':' でつないで行キーにする（この 3 つで一意）
 *   - 前日終値・適用為替レートが無ければ、説明の式から referencePrice = 評価額_USD ÷ 数量、
 *     referenceFxRate = 評価額_JPY ÷ 評価額_USD で戻す
 *   - 口座ID・売却可能株数が無ければ値なし（'' / null）
 */

/**
 * 1 明細のアプリ内モデル。
 *
 * @typedef {{
 *   id: string,
 *   customerId: string,
 *   branchCode: string,
 *   accountNumber: string,
 *   customerName: string,
 *   customerNameKana: string,
 *   symbolCode: string,
 *   ticker: string,
 *   symbolName: string,
 *   quantity: number|null,
 *   sellableQuantity: number|null,
 *   specificDeposit: string,
 *   specificDepositName: string,
 *   valueUsd: number|null,
 *   valueJpy: number|null,
 *   averageCost: number|null,
 *   costJpy: number|null,
 *   profitLossJpy: number|null,
 *   profitLossRate: number|null,
 *   referencePrice: number|null,
 *   referenceFxRate: number|null,
 *   sellProhibited: boolean,
 *   corporateAction: string,
 * }} Holding
 *   id は行 ID（応答に無ければ 口座番号・銘柄コード・預り売買区分 を ':' でつないだ行キー）。
 *   customerId は顧客マスタの行 ID（顧客詳細のパスキー）。応答に無ければ ''。
 *   sellableQuantity は売却可能株数（残高 − 当日有効な売注文の数量。0 未満にはならない）。
 *   specificDeposit は特定預り区分のコード、specificDepositName はサーバが付ける名前。
 *   referencePrice は前日終値（USD）、referenceFxRate は評価に使った為替レート。
 *   金額は数値のまま返す（桁区切りと単位の付与は画面の仕事）。null は「値が無い」。
 *   profitLossRate は % の数値（-3.5 なら -3.5%）。
 *   corporateAction は CA 発生中の銘柄だけ埋まる（例: '株式分割(1 : 2)'）。無ければ ''。
 */

/**
 * 預り残高を検索する。
 *
 * ページャーを持てる一覧なので、配列ではなく `{ items, total }` を返す。
 * `limit` は 1〜200 で既定 50。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   branchCode?: string,
 *   accountNumber?: string,
 *   customerName?: string,
 *   symbol?: string,
 *   symbolName?: string,
 *   specificDeposit?: string,
 * }} [params]
 *   空文字は「条件なし」としてリクエストに載せない。
 *   symbol は銘柄コードか Ticker の完全一致、customerName / symbolName は部分一致（実 API の仕様）。
 * @returns {Promise<{ items: Holding[], total: number }>}
 */
export async function fetchHoldings({
  limit = 50,
  offset = 0,
  branchCode = '',
  accountNumber = '',
  customerName = '',
  symbol = '',
  symbolName = '',
  specificDeposit = '',
} = {}) {
  const { data } = await apiClient.get('/holdings', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      customer_name: customerName || undefined,
      symbol: symbol || undefined,
      symbol_name: symbolName || undefined,
      specific_deposit: specificDeposit || undefined,
    },
  })

  return {
    items: (data?.holdings ?? []).map(toHolding),
    total: data?.total ?? 0,
  }
}

/** HoldingItem → アプリ内モデル */
function toHolding(raw) {
  const accountNumber = raw?.口座番号 == null ? '' : String(raw.口座番号)
  const symbolCode = raw?.銘柄コード ?? ''
  const specificDeposit = raw?.預り売買区分 ?? ''
  const quantity = toNumberOrNull(raw?.数量)
  const valueUsd = toNumberOrNull(raw?.評価額_USD)
  const valueJpy = toNumberOrNull(raw?.評価額_JPY)

  return {
    // 冒頭の「項目が無い応答」の 1 番
    id: raw?.ID == null ? [accountNumber, symbolCode, specificDeposit].join(':') : String(raw.ID),
    customerId: raw?.口座ID == null ? '' : String(raw.口座ID),
    branchCode: raw?.部店コード ?? '',
    accountNumber,
    customerName: raw?.顧客名 ?? '',
    customerNameKana: raw?.顧客名カナ ?? '',
    symbolCode,
    ticker: raw?.ティッカー ?? '',
    symbolName: raw?.銘柄名 ?? '',
    quantity,
    sellableQuantity: toNumberOrNull(raw?.売却可能株数),
    specificDeposit,
    specificDepositName: raw?.預り売買区分名 ?? '',
    valueUsd,
    valueJpy,
    averageCost: toNumberOrNull(raw?.平均取得単価),
    costJpy: toNumberOrNull(raw?.取得金額),
    profitLossJpy: toNumberOrNull(raw?.評価損益),
    profitLossRate: toPercent(raw?.評価損益率),
    // 項目が無い応答では冒頭の 2 番の逆算に落とす。割れないとき（数量 0・評価額なし）は値なし
    referencePrice: toNumberOrNull(raw?.前日終値) ?? divide(valueUsd, quantity),
    referenceFxRate: toNumberOrNull(raw?.適用為替レート) ?? divide(valueJpy, valueUsd),
    // 1 だけが売却不可（説明「1=この明細は売却不可（画面の売ボタンを無効化する）」）
    sellProhibited: raw?.売却不可区分 === 1,
    corporateAction: raw?.CA ?? '',
  }
}

/**
 * 口座番号の検索条件 → クエリに載せる integer。
 * 実 API の 口座番号 は integer なので、数字だけの入力のときにだけ送る
 * （文字列のまま送ると 422 で弾かれ、検索できない理由が画面に出ない）。
 */
function toAccountNo(value) {
  const digits = String(value ?? '').trim()
  return /^\d+$/.test(digits) ? Number(digits) : undefined
}

/**
 * 「% 表記」の文字列 → 数値（'+12.34%' → 12.34、'-5.20%' → -5.2）。
 * 書式は '+12.34%' / '-5.20%' と確定した（#36 ④）が、% と前後の空白・桁区切り・+ の有無は緩く読む。
 * 読めなければ null。
 */
function toPercent(value) {
  if (typeof value === 'number') return toNumberOrNull(value)
  if (typeof value !== 'string') return null
  const text = value.replace(/[%,\s]/g, '').replace(/^\+/, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  return Number(text)
}

/** a ÷ b。どちらかが値なし、または b が 0 なら null */
function divide(a, b) {
  return a === null || b === null || b === 0 ? null : a / b
}

function toNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

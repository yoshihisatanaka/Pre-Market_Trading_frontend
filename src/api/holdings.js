import { apiClient } from './client'

/*
 * 預り残高の検索（実 API `GET /holdings`。m_残高情報 に口座・銘柄・為替・CA を結合した明細）。
 *
 * 成熟度 B（パスとスキーマ HoldingItem はあるが、下に挙げる値の意味が仕様の説明だけでは定まらない）。
 * 顧客詳細の外株預り（/customers/:customerId/summary）が 1 顧客ぶんを読む。
 * 預り検索（/customers/holdings。stores/holdingSearch.js）は同じ関数で顧客横断に読む。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり。
 *   - プロパティ名が日本語（口座番号 / 銘柄コード / 評価額_JPY …）
 *   - クエリ名は英語の snake_case（branch_code / account_no / symbol / symbol_name / specific_deposit）
 *   - 口座番号は integer で、クエリ名は `account_no`。アプリ内は文字列
 *   - 売却不可区分は 0 / 1 の integer。アプリ内は boolean
 *   - 評価損益率は「% 表記」の文字列。アプリ内は数値（12.34 なら 12.34%）
 *   - **行に ID が無い**。口座番号・銘柄コード・預り売買区分 を合わせて行のキーにする
 *     （残高明細はこの 3 つで 1 行。src/api/balanceAdjustments.js の残高マスタと同じ粒度）
 *   - `預り売買区分` は名前に反して**特定預り区分のコード**（0 非特定 / 1 特定 / 4 NISA / 6 成長投資枠 /
 *     8 継続管理勘定。HoldingItem の説明「特定預り区分コード」）。注文の 預り売買区分
 *     （0 特定 / 1 一般 / 6 成長投資枠）とは向きが違うので、注文へ渡すときは
 *     src/utils/orderEntryQuery.js の toDepositCategory で読み替える
 *
 * 仕様に書かれておらず、**推定で置いているもの**（docs/api/requests.md #36 で確認中）:
 *   - 参考単価（前日終値）と参考為替は項目として返らない。説明の式
 *     「評価額_USD = 前日終値 × 残高」「評価額_JPY = 前日終値 × 残高 × 為替レート」から
 *     referencePrice = 評価額_USD ÷ 数量、referenceFxRate = 評価額_JPY ÷ 評価額_USD で戻している
 *   - 取得金額・評価損益は円建てとして扱う（「評価損益 = 評価額_JPY − 取得金額」から）
 *   - 評価損益率は説明の式「(取得金額 / 評価額_JPY) − 1」だと損益と符号が逆になる。式の書き誤りと
 *     みなし、サーバの値をそのまま出す（フロントで計算し直さない）
 */

/**
 * 1 明細のアプリ内モデル。
 *
 * @typedef {{
 *   id: string,
 *   branchCode: string,
 *   accountNumber: string,
 *   customerName: string,
 *   customerNameKana: string,
 *   symbolCode: string,
 *   ticker: string,
 *   symbolName: string,
 *   quantity: number|null,
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
 *   id は 口座番号・銘柄コード・預り売買区分 を ':' でつないだ行キー（実 API に ID が無いため）。
 *   specificDeposit は特定預り区分のコード、specificDepositName はサーバが付ける名前。
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
    id: [accountNumber, symbolCode, specificDeposit].join(':'),
    branchCode: raw?.部店コード ?? '',
    accountNumber,
    customerName: raw?.顧客名 ?? '',
    customerNameKana: raw?.顧客名カナ ?? '',
    symbolCode,
    ticker: raw?.ティッカー ?? '',
    symbolName: raw?.銘柄名 ?? '',
    quantity,
    specificDeposit,
    specificDepositName: raw?.預り売買区分名 ?? '',
    valueUsd,
    valueJpy,
    averageCost: toNumberOrNull(raw?.平均取得単価),
    costJpy: toNumberOrNull(raw?.取得金額),
    profitLossJpy: toNumberOrNull(raw?.評価損益),
    profitLossRate: toPercent(raw?.評価損益率),
    // 冒頭の「推定で置いているもの」の 1 番。割れないとき（数量 0・評価額なし）は値なし
    referencePrice: divide(valueUsd, quantity),
    referenceFxRate: divide(valueJpy, valueUsd),
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
 * 「% 表記」の文字列 → 数値（'12.34%' → 12.34、'-5%' → -5）。
 * 書式は仕様に例が無いので、% と前後の空白・桁区切り・先頭の + を許して読む。読めなければ null。
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

import { apiClient } from './client'

/*
 * 滞留注文抽出（画面は `/operations/stalled-orders`）。
 *
 * ブローカー・自システムの障害で発注できなかった注文（注文エラー）と、別システムで
 * 発注しコンファメーションを取り込んだあと未約定のままの注文（注文中）を同時に返す。
 *
 * 一覧に専用の API は無く、注文照会と同じ `GET /orders` を処理状況で絞って 2 回呼ぶ
 * （docs/api/requests.md #1 ①。2026-09-30 に「既存の GET /orders を拡張する」で決着）:
 *   注文エラー … status=101,103（101 Dream発注失敗 / 103 IB発注失敗。「注文エラー」という処理状況は無い）
 *   注文中     … status=003
 * 注文中は処理状況だけで引くので、コンファメーション取込を経ずに注文中になっている注文
 * （通常の発注）も含む。取込を経たかどうかを見分ける項目が `OrderItemResponse` に無いため。
 *
 * コンファメーション CSV の取込（importConfirmationCsv）は、docs/api/requests.md の「契約提案」に
 * 書いた形のまま 2026-10-07 の取り込みで仕様に入った（POST /operations/stalled-orders/confirmation-import。
 * 応答は既存の CsvImportResponse）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - 1 本の一覧（`orders` / `total`）を処理状況で 2 回引き、注文エラー / 注文中の 2 本にして返す
 *   - 画面はページャを持たないので、`limit` の上限（200）ずつページを送って全件を集める
 *     （注文エラーの CSV 出力が別システムでの発注そのものなので、取りこぼすと発注漏れになる）
 *   - プロパティ名が日本語（ID / 部店 / 口座番号 / Ticker / 売買区分 …）
 *   - 口座番号は integer で、クエリ名は `account_no`。アプリ内は文字列
 *   - 売買区分は '1'（売）/ '3'（買）。アプリ内は 'buy' / 'sell'
 *   - 受注日と受注時刻が別項目（実 API は '20260826' のように区切りが無い）。アプリ内は 1 本の日時文字列
 *   - 市場区分と出来状況は名前（発注範囲名 / 表示状況名）をサーバが付けて返す
 *   - 発注失敗の理由は、Dream 発注失敗（101）なら `Dreamエラー内容`、IB 発注失敗（103）なら
 *     `エラー内容` に入る（`GET /orders/dream-status` の説明による）
 *
 * 画面の「確認状況」列にあたる項目はサーバに無い。2026-10-06 の回答で列は持たず d_約定・処理状況に
 * 乗せることになり、「確認済み」が業務上何を指すかは #1② で問合せ中。それまで confirmationNote は
 * 常に空文字で返す（画面は '—' を出す）。
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
 *   symbol は Ticker（無ければ銘柄コード）。別システム（TWS）へ渡す発注 CSV の symbol にもなる。
 *   orderType は 'LO'（指値）/ 'MO'（成行）。limitPrice は成行のとき null。
 *   statusName はサーバが付ける出来状況の表示名（表示状況名。無ければ処理状況名）。
 *   errorReason は注文エラーの行だけ埋まる。confirmationNote はいまは常に空文字（冒頭を参照）。
 */

/**
 * 売買区分（SideEnum）→ アプリ内の向き。
 * コードマスタ（GET /codes の 売買区分）は 1 売 / 3 買で、他の api 層（orderInquiry.js など）とも同じ向き
 */
const SIDES = { 1: 'sell', 3: 'buy' }

/** 注文エラー（Dream発注失敗 / IB発注失敗）と注文中の処理状況。`status` はカンマ区切りで複数指定できる */
const ORDER_ERROR_STATUSES = '101,103'
const WORKING_STATUS = '003'

/** Dream 発注失敗。理由が `エラー内容` ではなく `Dreamエラー内容` に入る */
const DREAM_ORDER_FAILED = '101'

/** `GET /orders` の limit の上限（仕様の maximum） */
const PAGE_SIZE = 200

/**
 * 滞留中の注文を取得する。
 *
 * ページャを持たない一覧なので `{ items, total }` ではなく、2 本の配列を返す
 * （画面が「注文エラー」と「注文中」を別のカードに並べるため）。
 * 並びはサーバの既定（注文 ID の降順）のまま。
 *
 * @param {{ branchCode?: string, accountNumber?: string, symbol?: string }} [params]
 *   空文字は「条件なし」としてリクエストに載せない。口座番号は数字だけのときにだけ送る（toAccountNo）
 * @returns {Promise<{ orderErrors: StalledOrder[], workingOrders: StalledOrder[] }>}
 */
export async function fetchStalledOrders({
  branchCode = '',
  accountNumber = '',
  symbol = '',
} = {}) {
  // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
  const filters = {
    branch_code: branchCode || undefined,
    account_no: toAccountNo(accountNumber),
    symbol: symbol || undefined,
  }

  const [orderErrors, workingOrders] = await Promise.all([
    fetchAllOrders({ ...filters, status: ORDER_ERROR_STATUSES }),
    fetchAllOrders({ ...filters, status: WORKING_STATUS }),
  ])

  return {
    orderErrors: orderErrors.map(toStalledOrder),
    workingOrders: workingOrders.map(toStalledOrder),
  }
}

/**
 * `GET /orders` をページ送りしながら、条件に合う注文（OrderItemResponse）を全件集める。
 * 集めた件数が `total` に届くか、空のページが返ったら止める
 * （空のページで止めるのは、取得中に件数が減って total に届かなくなっても回り続けないため）。
 */
async function fetchAllOrders(params) {
  const rows = []
  let total = 0

  do {
    const { data } = await apiClient.get('/orders', {
      params: { ...params, limit: PAGE_SIZE, offset: rows.length },
    })
    const page = data?.orders ?? []
    if (page.length === 0) break

    rows.push(...page)
    total = data?.total ?? 0
  } while (rows.length < total)

  return rows
}

/**
 * 取込の結果（アプリ内モデル）。
 *
 * @typedef {{
 *   success: boolean, totalCount: number, successCount: number, errorCount: number,
 *   message: string,
 *   errors: Array<{ lineNumber: number|null, orderId: string, messages: string[] }>,
 * }} ConfirmationImportResult
 *   success は行エラーが 0 件のときだけ true。1 件でもあれば 1 行も反映されない（提案）。
 *   message はサーバの文言で、画面はそのまま出す。
 *   lineNumber は CSV の行番号（ヘッダが 1 行目なのでデータは 2 から）。
 *   orderId はその行の order_id（読めなければ空文字）。
 */

/**
 * 別システムのコンファメーション CSV を取り込み、注文照会へ反映する。
 *
 * 行ごとの不備（知らない注文 ID など）は 200 の中の errors で返り、例外にならない。
 * ファイルそのものの不備（ヘッダ違い・空ファイル）は 400、file 欠落は 422 で ApiError になる。
 *
 * @param {File} file コンファメーション CSV（UTF-8。BOM の有無はサーバが吸収する）
 * @returns {Promise<ConfirmationImportResult>}
 */
export async function importConfirmationCsv(file) {
  const body = new FormData()
  // 項目名はモックの confirmation_file ではなく、既存の /masters/*/import-csv に揃えた file（提案）
  body.append('file', file)

  const { data } = await apiClient.post('/operations/stalled-orders/confirmation-import', body, {
    /*
     * client.js の既定は application/json。そのままだと axios は FormData を JSON に直して送る。
     * multipart を明示すれば、境界（boundary）付きの Content-Type はブラウザが付け直す。
     */
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return toImportResult(data)
}

/** CsvImportResponse → ConfirmationImportResult */
function toImportResult(raw) {
  return {
    success: Boolean(raw?.success),
    totalCount: toCount(raw?.total_count),
    successCount: toCount(raw?.success_count),
    errorCount: toCount(raw?.error_count),
    message: raw?.message ?? '',
    errors: (raw?.errors ?? []).map(toImportError),
  }
}

/** CsvImportErrorItem → 1 行ぶんのエラー */
function toImportError(raw) {
  const orderId = raw?.row_data?.order_id
  return {
    lineNumber: Number.isInteger(raw?.line_number) ? raw.line_number : null,
    orderId: orderId == null ? '' : String(orderId),
    messages: raw?.errors ?? [],
  }
}

function toCount(value) {
  return Number.isInteger(value) ? value : 0
}

/** OrderItemResponse → StalledOrder */
function toStalledOrder(raw) {
  return {
    id: raw?.ID == null ? '' : String(raw.ID),
    branchCode: raw?.部店 ?? '',
    // 口座番号は integer で来るが、画面は桁を揃えて出すだけなので文字列に寄せる
    accountNumber: raw?.口座番号 == null ? '' : String(raw.口座番号),
    customerName: raw?.顧客名 ?? '',
    // 別システム（TWS）で発注するにはティッカーが要る。無い行だけ銘柄コードで代える
    symbol: raw?.Ticker || raw?.銘柄コード || '',
    // 知らないコードは空にする。'1'/'3' 以外を 'buy' に丸めると買いと売りを取り違える
    side: SIDES[raw?.売買区分] ?? '',
    quantity: toNumberOrNull(raw?.数量),
    orderType: raw?.指成区分 ?? '',
    /*
     * 指値単価だけは null のまま通す。成行注文は値を持たないので、0 に寄せると
     * 「0 ドルの指値」と見分けが付かなくなる（画面は orderType を見て「成行」と出す）。
     * decimal なので数値の文字列（'228.5000'）でも受ける。
     */
    limitPrice: toDecimalOrNull(raw?.指値単価),
    marketCategoryName: raw?.発注範囲名 ?? '',
    orderedAt: toOrderedAt(raw?.受注日, raw?.受注時刻),
    // 出来状況の列。注文照会（src/api/orderInquiry.js）と同じく表示状況名を出す
    statusName: raw?.表示状況名 || raw?.処理状況名 || '',
    errorReason: toErrorReason(raw),
    confirmationNote: '',
  }
}

/**
 * 発注失敗の理由。Dream 発注失敗（101）は `Dreamエラー内容`、それ以外（103 IB 発注失敗）は
 * `エラー内容` を先に見て、空ならもう片方で代える。注文中の行はどちらも空なので空文字になる。
 */
function toErrorReason(raw) {
  const dream = raw?.Dreamエラー内容 ?? ''
  const broker = raw?.エラー内容 ?? ''
  return raw?.処理状況 === DREAM_ORDER_FAILED ? dream || broker : broker || dream
}

/**
 * 口座番号の検索条件 → クエリに載せる integer。
 * 実 API の 口座番号 は integer なので、数字だけの入力のときにだけ送る
 * （文字列のまま送ると 422 で弾かれ、検索できない理由が画面に出ない。src/api/orderInquiry.js と同じ扱い）。
 */
function toAccountNo(value) {
  const digits = String(value ?? '').trim()
  return /^\d+$/.test(digits) ? Number(digits) : undefined
}

/**
 * 別項目で来る受注日と受注時刻を 1 本の日時にまとめる（'2026-09-16T10:22:00'）。
 * 仕様は string とだけ書いているので、区切りの有無（20260916 / 102200）はどちらも受ける。
 * どちらかが欠けていたら空文字にして、画面側の整形に '—' を出させる。
 */
function toOrderedAt(date, time) {
  const d = String(date ?? '').replace(/\D/g, '')
  const t = String(time ?? '').replace(/\D/g, '')
  if (d.length !== 8 || t.length < 4) return ''
  const seconds = t.length >= 6 ? t.slice(4, 6) : '00'
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${seconds}`
}

function toNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** toNumberOrNull に加えて、数値の文字列（decimal の直列化 '228.5000'）も数値にする */
function toDecimalOrNull(value) {
  if (typeof value === 'string' && value.trim() !== '') return toNumberOrNull(Number(value))
  return toNumberOrNull(value)
}

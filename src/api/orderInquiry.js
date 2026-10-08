import { ApiError, apiClient } from './client'

/*
 * 注文照会と、そこから入る訂正・取消（実 API `GET /orders` / `GET /orders/{order_id}` /
 * `POST /orders/{order_id}/amend` / `POST /orders/{order_id}/cancel`）。
 *
 * 同じパスを縦串の参考実装（src/api/orders.js の fetchOrders・OrderListView）も叩いているが、
 * あちらは実仕様が来る前の仮の形（`items`）を読む。参考実装を退役させるときに向こうを消せば済むよう、
 * 実仕様の形を読むこの画面の層は別ファイルに分けてある。
 *
 * 成熟度 B（パスとスキーマはあるが、下に挙げる値の意味が仕様に書かれていない）。
 *
 * 一覧（GET /orders）について、バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - プロパティ名が日本語（ID / 部店 / 口座番号 / 銘柄コード / 表示状況名 …）
 *   - 一覧の配列名が `orders`、件数が `total`
 *   - 口座番号は integer で、クエリ名は `account_no`。アプリ内は文字列
 *   - 売買区分は '1'（売）/ '3'（買）（`GET /orders` の `side` クエリの説明による）。アプリ内は 'sell' / 'buy'
 *   - 受注日と受注時刻が別項目。アプリ内は 1 本の日時文字列
 *   - 取消・訂正の可否は 処理状況 のコードで決まる（下の CANCELABLE / AMENDABLE）
 *   - 訂正と自動分割（スライス）は別々の行で返る。画面は元注文ごとの 1 行に畳んで出すので、
 *     この層で `元注文ID` を手がかりにまとめる（groupOrders）
 *   - 出来状況の絞り込みは、コードマスタの `注文照会出来状況` のコードで受け、`status`
 *     （カンマ区切りで複数指定可）に載せる。取消済（034）は 032,034、注文エラー（101）は 101,103 に
 *     広げる（コードマスタの選択肢は代表の 1 コードしか持たない。docs/api/requests.md #28 ①）
 *
 * 仕様に書かれておらず、**推定で置いているもの**（処理をつなぐ前にバックエンドへ確かめる）:
 *   - `元注文ID` は訂正・分割の起点（最初の注文）を指す。訂正を重ねても孫ではなく起点を指す
 *   - `注文種別` が 'SLICE_CHILD' の行はスライス子注文（`集計対象` の説明にある値）。それ以外で
 *     `元注文ID` を持つ行は訂正注文とみなす（PARTIAL_FILL / VWAP_AGGREGATED の扱いは未確認）
 *   - ページングは行単位なので、1 つの訂正の連なりがページの境目で割れることがある
 *   - 絞り込み（`status` も含む）も行単位なので、たとえば「取消済」で絞ると、訂正で取り消された
 *     原注文の版だけが当たって行になることがある（最新の版の状況で絞る画面モックとは違う）
 *
 * 画面モックにあってこの API に無い項目（送信日時）はアプリ内モデルに持たせない（無いものを null として運ばない）。
 * 市場区分は `発注範囲` のコード（'02' / '03' / '04' / '06'）で運ぶ。名前は画面が src/utils/orderTypes.js で引く。
 *
 * 自動分割の明細の見出し（適用上限 / 適用理由 / 5 営業日平均出来高 / 参照価格）は**契約提案**で読む
 * （docs/api/requests.md #57）。発注時のスライス判定の結果で、バックエンドは判定に使うだけで保存していない
 * （d_スライス注文管理 は総数量・分割数・基準数量・端数だけ）。いまの設定で計算し直す
 * `POST /masters/hard-limits/simulate` では設定や出来高が変わった後に発注時と違う値が出るので使わない。
 * 項目は親（`注文種別` 'SLICE_PARENT'）の行に `スライス適用上限数量` / `スライス適用理由` /
 * `スライス平均出来高` / `スライス参照価格` で載る想定で、MSW のフィクスチャだけが返す。
 * 実 API では無いので slicePlan が null になり、画面は「—」を出す。
 */

/**
 * 1 注文のアプリ内モデル。
 *
 * @typedef {{
 *   id: string, originalOrderId: string, branchCode: string, accountNumber: string,
 *   customerName: string, symbol: string, side: 'buy'|'sell'|'', quantity: number|null,
 *   canceledQuantity: number|null, orderType: string, limitPrice: number|null,
 *   filledQuantity: number|null, remainingQuantity: number|null,
 *   filledAmountUsd: number|null, filledAmountJpy: number|null,
 *   marketScope: string, vwap: boolean, forced: boolean, statusName: string,
 *   statusTone: ''|'pending'|'working'|'partial'|'filled'|'canceled'|'error',
 *   errorReason: string, orderedAt: string, amendable: boolean, cancelable: boolean,
 *   slicePlan: SlicePlan|null,
 * }} OrderInquiryOrder
 *   orderType は 'LO'（指値）/ 'MO'（成行）。limitPrice は成行のとき null。
 *   forced は強制区分付きで発注した注文（`強制区分` が 1）。
 *   statusName はサーバが付ける出来状況の表示名（表示状況名）、statusTone はその色分け。
 *   errorReason は注文エラーの行だけ埋まる。
 *   slicePlan はスライスの親の行だけが持つ（4 項目のどれも来ない行は null）。
 */

/**
 * 発注時のスライス判定の結果（契約提案。冒頭のコメントを参照）。
 *
 * @typedef {{
 *   maxSliceQuantity: number|null, reasons: string[],
 *   averageVolume: number|null, referencePrice: number|null,
 * }} SlicePlan
 *   maxSliceQuantity は子注文 1 本あたりの上限株数、reasons はスライス対象になった理由（サーバの文言）、
 *   averageVolume は判定に使った 5 営業日平均出来高（銘柄マスタの取込値）、
 *   referencePrice は金額の判定に使った単価（USD。指値なら指値単価、成行なら前日終値）。
 */

/**
 * 画面の 1 行（元注文ごとのまとまり）。
 *
 * @typedef {{
 *   id: string,
 *   latest: OrderInquiryOrder,
 *   history: OrderInquiryOrder[],
 *   slices: OrderInquiryOrder[],
 * }} OrderInquiryGroup
 *   id は起点の注文 ID（画面の「注文ID」列に出す）。latest は最新の版で、行の各列はこれを出す。
 *   history は latest より前の版（古い順。先頭が原注文）、slices はスライス子注文（ID 順）。
 */

/**
 * 訂正・取消の画面が読む 1 注文（`GET /orders/{order_id}`）のアプリ内モデル。
 *
 * @typedef {{
 *   id: string, branchCode: string, accountNumber: string, customerName: string, symbol: string,
 *   side: 'buy'|'sell'|'', quantity: number|null, orderType: string, limitPrice: number|null,
 *   marketScope: string, vwap: boolean, status: string, statusName: string,
 *   filledQuantity: number,
 *   orderedAt: string, amendable: boolean, cancelable: boolean,
 * }} OrderDetail
 *   symbol は Ticker（無ければ銘柄コード）。status は処理状況コード、statusName はサーバの
 *   処理状況名（無い応答では ''。画面が src/utils/orderTypes.js で引く）。
 *   filledQuantity はサーバの 出来数量（無い応答では約定の合計。約定が無ければ 0）。
 *   有効残数量 は運ばない。注文エラー（101 / 103）は取消できるのに 0 で返り、取消画面の
 *   「取消対象（未約定残）」には使えない（画面は 数量 − 出来数量 で出す）。
 *
 * `order`（OrderRecord）は 2026-10-06 の回答で一覧と同じ派生項目（顧客名・処理状況名・表示状況名・
 * 出来数量・有効残数量 など）を持つようになった（docs/api/requests.md #3 ②）。派生項目の無い応答
 * （古いサーバ）でも画面が止まらないよう、無いときだけ従来の計算に落とす。
 * 注文ルート は DB の生値、注文ルートコード が正規化したコード（預託先参照権限が無いと null）。
 * この画面は預託先を使わないので運ばない。
 */

/**
 * 訂正の結果。
 *
 * @typedef {{
 *   mode: 'inPlace'|'cancelReplace'|'', originalOrderId: string, amendmentOrderId: string,
 *   message: string, warnings: string[],
 * }} AmendResult
 *   inPlace は未発注の注文をその場で書き換えた、cancelReplace は原注文を取り消して訂正注文
 *   （amendmentOrderId）を作った。message はサーバが決める文言で、画面はそのまま出す。
 */

/**
 * 取消の結果。
 *
 * @typedef {{ orderId: string, message: string, warnings: string[] }} CancelResult
 */

/** 売買区分（SideEnum）→ アプリ内の向き */
const SIDES = { 1: 'sell', 3: 'buy' }

/** スライス子注文を表す 注文種別 */
const SLICE_CHILD = 'SLICE_CHILD'

/*
 * 取消・訂正を受け付ける 処理状況。`POST /orders/{order_id}/cancel` と
 * `POST /orders/{order_id}/amend` の説明にある一覧の写し。
 *   取消 … 000 未発注 / 003 注文中 / 010 一部出来 / 131・133 取消失敗 / 101・103 発注失敗 /
 *          141 訂正中断（amend の説明「取り下げは POST /orders/{訂正注文ID}/cancel」による）
 *   訂正 … 000 / 003 / 010（訂正待ち 040 の訂正注文はここに入らないので不可）
 */
const CANCELABLE = new Set(['000', '003', '010', '131', '133', '101', '103', '141'])
const AMENDABLE = new Set(['000', '003', '010'])

/**
 * 出来状況の選択肢のコード（コードマスタ `注文照会出来状況`）→ `status` に載せる処理状況コード。
 * 取消済と注文エラーは処理状況が 2 つずつあるので、代表のコードを両方に広げる
 */
const STATUS_QUERY = { '034': '032,034', 101: '101,103' }

/** 訂正の結果の mode → アプリ内の名前 */
const AMEND_MODES = { IN_PLACE: 'inPlace', CANCEL_REPLACE: 'cancelReplace' }

/*
 * 出来状況の色分け。文言（表示状況名）はサーバが付けるが、色は処理状況のコードで決める
 * （文言で分岐すると、言い回しが変わっただけで黙って色が消える）。コードの意味は
 * 取消・訂正 API の説明から拾ったもの。ここに無いコード（処理中・取消依頼など）は色を付けない。
 */
const STATUS_TONES = {
  '000': 'pending',
  '003': 'working',
  '010': 'partial',
  '011': 'filled',
  '032': 'canceled',
  '034': 'canceled',
  101: 'error',
  103: 'error',
}

/**
 * 注文を検索する。
 *
 * ページャーを持つ一覧なので `{ items, total }` を返す。items は元注文ごとにまとめた行で、
 * total はサーバが数えた注文の行数（訂正前の版とスライス子注文を含む）。
 *
 * @param {{
 *   limit?: number, offset?: number,
 *   branchCode?: string, accountNumber?: string, symbol?: string, executionStatus?: string,
 * }} [params]
 *   空文字は「条件なし」としてリクエストに載せない。
 *   executionStatus（出来状況）は処理状況コード（コードマスタ `注文照会出来状況` のコード）で受ける。
 *   `status` はカンマ区切りで複数のコードを受けるので、取消済（034）は 032,034、
 *   注文エラー（101）は 101,103 に広げて送る（STATUS_QUERY）。ほかのコードはそのまま送る
 * @returns {Promise<{ items: OrderInquiryGroup[], total: number }>}
 */
export async function fetchOrderInquiry({
  limit = 50,
  offset = 0,
  branchCode = '',
  accountNumber = '',
  symbol = '',
  executionStatus = '',
} = {}) {
  const { data } = await apiClient.get('/orders', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      symbol: symbol || undefined,
      status: executionStatus ? (STATUS_QUERY[executionStatus] ?? executionStatus) : undefined,
    },
  })

  return {
    items: groupOrders(data?.orders ?? []),
    total: data?.total ?? 0,
  }
}

/**
 * 1 注文を読む（訂正・取消の画面の対象注文）。
 *
 * 一覧から行を受け渡さず、画面を開くたびにここで読み直す。URL を直接開いても表示でき、
 * 一覧を開いてから時間が経って状況が変わっていても、いまの状況で訂正・取消の可否を出せる。
 *
 * @param {string} id 注文 ID
 * @returns {Promise<OrderDetail>} 注文が無ければ 404 の ApiError
 */
export async function fetchOrderDetail(id) {
  const { data } = await apiClient.get(`/orders/${encodeURIComponent(id)}`)
  return toOrderDetail(data?.order, data?.executions)
}

/**
 * 注文を訂正する（`POST /orders/{order_id}/amend`）。
 *
 * 更新は部分更新（サーバは本文に含めた項目だけを変える）。**渡した項目だけを本文に載せる**ので、
 * 呼び出し側は変えた項目だけを渡す（変えていない項目まで送ると、サーバは変更として扱う）。
 * 成行へ変えるときは limitPrice を渡さない（「成行(MO)へ変更する場合は不要」）。
 *
 * @param {{
 *   id: string, quantity?: number, orderType?: 'LO'|'MO', limitPrice?: number,
 *   marketScope?: string, reason?: string,
 * }} params quantity は出来分を含む総数量。reason は空なら送らない
 * @returns {Promise<AmendResult>} 受け付けられなければ ApiError（400 は理由付き）
 */
export async function amendOrder({ id, quantity, orderType, limitPrice, marketScope, reason }) {
  // undefined の項目は JSON に出ない（＝送らない）
  const { data } = await apiClient.post(`/orders/${encodeURIComponent(id)}/amend`, {
    数量: quantity,
    指成区分: orderType,
    指値単価: limitPrice,
    発注範囲: marketScope,
    理由: reason || undefined,
  })

  if (data?.success !== true) {
    throw new ApiError(data?.message || '注文を訂正できませんでした。')
  }

  return {
    mode: AMEND_MODES[data.mode] ?? '',
    originalOrderId: toIdString(data.original_order_id),
    amendmentOrderId: toIdString(data.amendment_order_id),
    message: data.message ?? '',
    warnings: toStrings(data.warnings),
  }
}

/**
 * 注文を取り消す（`POST /orders/{order_id}/cancel`）。
 *
 * 本文（OrderCancelRequest）は任意で、何も載せない。
 *   理由   … 取消に理由は持たせない（2026-09-29 決定。API からも削除される予定）
 *   取消者 … 送らない（サーバが認証情報の操作者で記録し、本文の値は無視する。docs/api/requests.md #28 ③）
 *
 * @param {{ id: string }} params
 * @returns {Promise<CancelResult>} 受け付けられなければ ApiError（400 は理由付き）
 */
export async function cancelOrder({ id }) {
  const { data } = await apiClient.post(`/orders/${encodeURIComponent(id)}/cancel`, {})

  if (data?.success !== true) {
    const reasons = toStrings(data?.errors)
    throw new ApiError(
      reasons.join(' / ') || data?.message || '注文を取り消せませんでした。',
    )
  }

  return {
    orderId: toIdString(data.order_id),
    message: data.message ?? '',
    warnings: toStrings(data.warnings),
  }
}

/** OrderItemResponse → アプリ内モデル */
function toOrder(raw) {
  const status = raw?.処理状況 ?? ''
  const originalOrderId = raw?.元注文ID == null ? '' : String(raw.元注文ID)

  return {
    id: String(raw?.ID ?? ''),
    originalOrderId,
    branchCode: raw?.部店 ?? '',
    // 口座番号は integer で来るが、画面は桁を揃えて出すだけなので文字列に寄せる
    accountNumber: raw?.口座番号 == null ? '' : String(raw.口座番号),
    customerName: raw?.顧客名 ?? '',
    symbol: raw?.銘柄コード ?? '',
    // 知らないコードは空にする。'1'/'3' 以外を片方に丸めると買いと売りを取り違える
    side: SIDES[raw?.売買区分] ?? '',
    quantity: toNumberOrNull(raw?.数量),
    canceledQuantity: toNumberOrNull(raw?.取消数量),
    orderType: raw?.指成区分 ?? '',
    // 成行は値を持たないので null のまま通す（0 に寄せると「0 ドルの指値」と見分けられない）
    limitPrice: toNumberOrNull(raw?.指値単価),
    filledQuantity: toNumberOrNull(raw?.出来数量),
    remainingQuantity: toNumberOrNull(raw?.有効残数量),
    filledAmountUsd: toNumberOrNull(raw?.約定代金),
    filledAmountJpy: toNumberOrNull(raw?.約定代金_JPY),
    marketScope: raw?.発注範囲 ?? '',
    vwap: raw?.VWAP区分 === 1,
    forced: raw?.強制区分 === 1,
    statusName: raw?.表示状況名 ?? raw?.処理状況名 ?? '',
    statusTone: STATUS_TONES[status] ?? '',
    errorReason: raw?.エラー内容 ?? '',
    orderedAt: toOrderedAt(raw?.受注日, raw?.受注時刻),
    cancelable: CANCELABLE.has(status),
    amendable: AMENDABLE.has(status),
    slicePlan: toSlicePlan(raw),
  }
}

/**
 * 発注時のスライス判定（契約提案の 4 項目）→ SlicePlan。どれも来ない行（子注文・通常の注文・
 * いまの実 API）は null にして、画面が「判定結果が無い」と見分けられるようにする。
 */
function toSlicePlan(raw) {
  const reasons = toStrings(raw?.スライス適用理由)
  const plan = {
    maxSliceQuantity: toNumberOrNull(raw?.スライス適用上限数量),
    reasons,
    averageVolume: toNumberOrNull(raw?.スライス平均出来高),
    referencePrice: toDecimalOrNull(raw?.スライス参照価格),
  }
  const empty =
    plan.maxSliceQuantity === null &&
    reasons.length === 0 &&
    plan.averageVolume === null &&
    plan.referencePrice === null
  return empty ? null : plan
}

/**
 * 注文詳細の `order`（OrderRecord）と `executions`（d_約定 の行）→ アプリ内モデル。
 *
 * 列名は一覧の OrderItemResponse と同じ日本語名なので、読み方も toOrder に揃える。
 * 違うのは次の 2 点。
 *   - 派生項目（出来数量 / 処理状況名 / 顧客名）はサーバの値を使い、無い応答のときだけ
 *     出来数量を約定の `約定数量` の合計で代える（名前は代えずに空にし、画面が補う）
 *   - `指値単価` は decimal(15,4) で、数値の文字列（'410.0000'）で来うる。数値と数値の文字列の両方を受ける
 */
function toOrderDetail(raw, executions) {
  const status = raw?.処理状況 ?? ''
  const serverFilled = toDecimalOrNull(raw?.出来数量)
  const filledQuantity =
    serverFilled ??
    (Array.isArray(executions) ? executions : []).reduce(
      (sum, execution) => sum + (toDecimalOrNull(execution?.約定数量) ?? 0),
      0,
    )

  return {
    id: toIdString(raw?.ID),
    branchCode: raw?.部店 ?? '',
    accountNumber: raw?.口座番号 == null ? '' : String(raw.口座番号),
    customerName: raw?.顧客名 ?? '',
    symbol: raw?.Ticker || raw?.銘柄コード || '',
    side: SIDES[raw?.売買区分] ?? '',
    quantity: toDecimalOrNull(raw?.数量),
    orderType: raw?.指成区分 ?? '',
    limitPrice: toDecimalOrNull(raw?.指値単価),
    marketScope: raw?.発注範囲 ?? '',
    vwap: Number(raw?.VWAP区分) === 1,
    status,
    // 処理状況名（未発注 / 注文中 …）。表示状況名（未出来 / 取消中 …）は一覧の出来状況の語で、
    // 訂正・取消の画面が出す「処理状況」とは別の語なので使わない
    statusName: raw?.処理状況名 ?? '',
    filledQuantity,
    orderedAt: toOrderedAt(raw?.受注日, raw?.受注時刻),
    amendable: AMENDABLE.has(status),
    cancelable: CANCELABLE.has(status),
  }
}

/**
 * 生の行を元注文ごとにまとめる。並びはサーバの順（既定は注文 ID の降順）を、各まとまりが
 * 最初に現れた位置で保つ。前提は冒頭の「推定で置いているもの」を参照。
 *
 * @param {object[]} rows OrderItemResponse の配列
 * @returns {OrderInquiryGroup[]}
 */
function groupOrders(rows) {
  const groups = new Map()

  for (const raw of rows) {
    const order = toOrder(raw)
    const rootId = order.originalOrderId || order.id
    if (!groups.has(rootId)) groups.set(rootId, { versions: [], slices: [] })

    const group = groups.get(rootId)
    if (raw?.注文種別 === SLICE_CHILD) group.slices.push(order)
    else group.versions.push(order)
  }

  return [...groups].flatMap(([id, group]) => {
    const slices = sortById(group.slices)

    // 子注文だけが検索に当たり、親がこのページに無いときは子注文を 1 件ずつ行として出す
    if (group.versions.length === 0) {
      return slices.map((slice) => ({ id: slice.id, latest: slice, history: [], slices: [] }))
    }

    const versions = sortById(group.versions)
    return [{ id, latest: versions.at(-1), history: versions.slice(0, -1), slices }]
  })
}

/** 注文 ID の昇順に並べた新しい配列を返す（元の配列は触らない） */
function sortById(orders) {
  return [...orders].sort((a, b) => Number(a.id) - Number(b.id))
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
 * 別項目で来る受注日と受注時刻を 1 本の日時にまとめる（'2026-09-28T09:15:00'）。
 * 仕様は string とだけ書いているので、区切りの有無（20260928 / 091500）はどちらも受ける。
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

/** toNumberOrNull に加えて、数値の文字列（decimal の直列化 '410.0000'）も数値にする */
function toDecimalOrNull(value) {
  if (typeof value === 'string' && value.trim() !== '') return toNumberOrNull(Number(value))
  return toNumberOrNull(value)
}

/** integer の ID → 文字列。null / undefined は空文字（画面で「#」だけを出さない） */
function toIdString(value) {
  return value == null ? '' : String(value)
}

/** 文字列の配列だけを通す（warnings / errors。既定は [] だが nullable に備える） */
function toStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : []
}

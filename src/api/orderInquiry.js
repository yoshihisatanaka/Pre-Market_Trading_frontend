import { apiClient } from './client'

/*
 * 注文照会（実 API `GET /orders`。`OrderListResponse` / `OrderItemResponse`）。
 *
 * 同じパスを縦串の参考実装（src/api/orders.js の fetchOrders・OrderListView）も叩いているが、
 * あちらは実仕様が来る前の仮の形（`items`）を読む。参考実装を退役させるときに向こうを消せば済むよう、
 * 実仕様の形を読むこの画面の層は別ファイルに分けてある。
 *
 * 成熟度 B（パスとスキーマはあるが、下に挙げる値の意味が仕様に書かれていない）。
 * **画面はいま UI だけの段階**で、検索・訂正・取消の処理は後日つなぐ（`TODO(処理実装)`）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - プロパティ名が日本語（ID / 部店 / 口座番号 / 銘柄コード / 表示状況名 …）
 *   - 一覧の配列名が `orders`、件数が `total`
 *   - 口座番号は integer で、クエリ名は `account_no`。アプリ内は文字列
 *   - 売買区分は '1'（売）/ '3'（買）（`GET /orders` の `side` クエリの説明による）。アプリ内は 'sell' / 'buy'
 *   - 受注日と受注時刻が別項目。アプリ内は 1 本の日時文字列
 *   - 取消・訂正の可否は 処理状況 のコードで決まる（下の CANCELABLE / AMENDABLE）
 *   - 訂正と自動分割（スライス）は別々の行で返る。画面は元注文ごとの 1 行に畳んで出すので、
 *     この層で `元注文ID` を手がかりにまとめる（groupOrders）
 *
 * 仕様に書かれておらず、**推定で置いているもの**（処理をつなぐ前にバックエンドへ確かめる）:
 *   - `元注文ID` は訂正・分割の起点（最初の注文）を指す。訂正を重ねても孫ではなく起点を指す
 *   - `注文種別` が 'SLICE_CHILD' の行はスライス子注文（`集計対象` の説明にある値）。それ以外で
 *     `元注文ID` を持つ行は訂正注文とみなす（PARTIAL_FILL / VWAP_AGGREGATED の扱いは未確認）
 *   - ページングは行単位なので、1 つの訂正の連なりがページの境目で割れることがある
 *
 * 画面モックにあってこの API に無い項目（送信日時・自動分割の適用上限 / 適用理由 /
 * 5 営業日平均出来高 / 参照価格）はアプリ内モデルに持たせない（無いものを null として運ばない）。
 * 市場区分は `発注範囲` のコード（'01'〜'06'）しか来ず、名前との対応が仕様に無いのでコードのまま運ぶ。
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
 *   marketScope: string, vwap: boolean, statusName: string,
 *   statusTone: ''|'pending'|'working'|'partial'|'filled'|'canceled'|'error',
 *   errorReason: string, orderedAt: string, amendable: boolean, cancelable: boolean,
 * }} OrderInquiryOrder
 *   orderType は 'LO'（指値）/ 'MO'（成行）。limitPrice は成行のとき null。
 *   statusName はサーバが付ける出来状況の表示名（表示状況名）、statusTone はその色分け。
 *   errorReason は注文エラーの行だけ埋まる。
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

/** 売買区分（SideEnum）→ アプリ内の向き */
const SIDES = { 1: 'sell', 3: 'buy' }

/** スライス子注文を表す 注文種別 */
const SLICE_CHILD = 'SLICE_CHILD'

/*
 * 取消・訂正を受け付ける 処理状況。`POST /orders/{order_id}/cancel` と
 * `POST /orders/{order_id}/amend` の説明にある一覧の写し。
 *   取消 … 000 未発注 / 003 注文中 / 010 一部出来 / 131・133 取消失敗 / 101・103 発注失敗
 *   訂正 … 000 / 003 / 010（訂正待ち 040 の訂正注文はここに入らないので不可）
 */
const CANCELABLE = new Set(['000', '003', '010', '131', '133', '101', '103'])
const AMENDABLE = new Set(['000', '003', '010'])

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
 *   executionStatus（出来状況）はまだ送らない。画面の選択肢（未出来 / 注文中 …）と
 *   `status`（処理状況コード）の対応が決まっていないため
 * @returns {Promise<{ items: OrderInquiryGroup[], total: number }>}
 */
export async function fetchOrderInquiry({
  limit = 50,
  offset = 0,
  branchCode = '',
  accountNumber = '',
  symbol = '',
} = {}) {
  const { data } = await apiClient.get('/orders', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      symbol: symbol || undefined,
      // TODO(処理実装): 出来状況 → status（処理状況コード）の対応を決めて送る
    },
  })

  return {
    items: groupOrders(data?.orders ?? []),
    total: data?.total ?? 0,
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
    statusName: raw?.表示状況名 ?? raw?.処理状況名 ?? '',
    statusTone: STATUS_TONES[status] ?? '',
    errorReason: raw?.エラー内容 ?? '',
    orderedAt: toOrderedAt(raw?.受注日, raw?.受注時刻),
    cancelable: CANCELABLE.has(status),
    amendable: AMENDABLE.has(status),
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

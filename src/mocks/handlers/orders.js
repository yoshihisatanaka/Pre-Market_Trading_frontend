import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'
import { orderInquiryFxRate, orderInquiryRows } from '../fixtures/orderInquiry'
import { detailError, nowIsoTimestamp, toNonNegativeInt, toStatusList } from './_shared'

/*
 * `GET /orders` は 2 つの画面が叩いている。
 *   - 注文一覧（`/`）… 縦串の参考実装。実仕様が来る前の仮の形 `items` を読む
 *   - 注文照会（`/orders/inquiry`）… 実仕様の `OrderListResponse`（`orders` / `total` …）を読む
 * 1 本のハンドラで両方の形を 1 つの応答に載せて返す（同じパスにハンドラを 2 本置くと先の 1 本しか効かない）。
 * 参考実装を退役させるときに `items` を外し、実 API に切り替えるときはこのハンドラごと消す。
 * 滞留注文抽出（`/operations/stalled-orders`）も同じ `orders` を処理状況（101,103 / 003）で絞って読む。
 *
 * 注文照会から入る訂正・取消の画面のために、1 件の詳細（GET /orders/{order_id}）・訂正・取消も持つ。
 * 訂正・取消は行を書き換えるので、行は可変状態にしてある（resetOrderInquiryRows で元に戻す）。
 * 状況の遷移は実 API の説明（amend / cancel の description）どおり:
 *   訂正 … 000 はその場で書き換え（IN_PLACE）。003 / 010 は原注文を 030（未取消）にし、
 *          040（訂正待ち）の訂正注文を新しい ID で足す（CANCEL_REPLACE）。それ以外は 400
 *   取消 … 000 / 101 / 103 は 034（取消済）。003 / 010 / 131 / 133 / 141 は 030（未取消）。それ以外は 400
 */

/** 訂正を受け付ける処理状況（amend の description） */
const AMENDABLE = ['000', '003', '010']
/** その場で取消済にする処理状況と、取消依頼（030）にする処理状況（cancel の description） */
const CANCEL_NOW = ['000', '101', '103']
const CANCEL_REQUEST = ['003', '010', '131', '133', '141']

/*
 * 状況が変わった行に付ける名前。フィクスチャの表示名（画面モック寄り）に揃える。
 * アプリ側の対応表（src/utils/orderTypes.js）は使わない（モックはアプリに依存させない。
 * src/utils/apiEnums.js の冒頭と同じ方針）。
 */
const STATUS_NAMES = { '000': '未発注', '030': '未取消', '034': '取消済', '040': '訂正待ち' }
const DISPLAY_NAMES = { '000': '未出来', '030': '取消中', '034': '取消済', '040': '訂正待ち' }

let rows = structuredClone(orderInquiryRows)

/** モックの注文をフィクスチャの内容に戻す（テスト間で訂正・取消の結果を持ち越さない） */
export function resetOrderInquiryRows() {
  rows = structuredClone(orderInquiryRows)
}

function findRow(orderId) {
  return rows.find((row) => String(row.ID) === String(orderId))
}

/** 取消・訂正で状況を変える。取消済になったら残りの株数は取消数量へ移す（一覧の派生項目の定義どおり） */
function setStatus(row, status) {
  row.処理状況 = status
  row.処理状況名 = STATUS_NAMES[status]
  row.更新日時 = nowIsoTimestamp()
  if (status === '034') {
    row.取消数量 = row.数量 - row.出来数量
    row.有効残数量 = 0
    row.表示状況名 = row.出来数量 > 0 ? '取消済（出来有）' : '取消済'
    row.集計対象 = false
  } else {
    row.表示状況名 = DISPLAY_NAMES[status]
  }
}

/**
 * 一覧の行 → 詳細の `order`（OrderRecord）。一覧と同じ派生項目（顧客名・処理状況名・出来数量・
 * 有効残数量 など）を持つ（docs/api/requests.md #3 ②）。注文ルート は DB の生値のままで、
 * 正規化したコードは 注文ルートコード に入る（フィクスチャの 注文ルート はコードなので同じ値を写す）
 */
function toDetailOrder(row) {
  return { ...row, 注文ルートコード: row.注文ルート ?? null }
}

/** 一覧の行 → 詳細の `executions`（d_約定 の行）。出来数量ぶんを 1 件の約定にまとめて返す */
function toExecutions(row) {
  if (!row.出来数量) return []
  return [
    {
      ID: row.ID * 100,
      注文ID: row.ID,
      OrderID: null,
      ExecID: `MOCK-${row.ID}`,
      約定数量: row.出来数量,
      約定単価: row.約定代金 ? row.約定代金 / row.出来数量 : null,
      約定日時: null,
      決済通貨区分: '1',
    },
  ]
}

export const orderHandlers = [
  http.get('*/api/orders', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = (params.get('branch_code') ?? '').trim()
    const accountNo = (params.get('account_no') ?? '').trim()
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
    // 処理状況はカンマ区切りで複数指定できる（例: 032,034）
    const statuses = toStatusList(params.get('status'))
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 部店・口座番号は完全一致、処理状況はカンマ区切りのどれかに一致、
    // 銘柄は銘柄コードか Ticker の部分一致（大小文字を問わない）
    const matches = (row) =>
      (!branchCode || row.部店 === branchCode) &&
      (!accountNo || String(row.口座番号) === accountNo) &&
      (!symbol ||
        row.銘柄コード.toUpperCase().includes(symbol) ||
        (row.Ticker ?? '').toUpperCase().includes(symbol)) &&
      (statuses.length === 0 || statuses.includes(row.処理状況))

    const sorted = [...rows.filter(matches)].sort((a, b) =>
      params.get('sort') === 'asc' ? a.ID - b.ID : b.ID - a.ID,
    )

    return HttpResponse.json({
      items: orderListResponse.items,
      total: sorted.length,
      limit,
      offset,
      適用為替レート: orderInquiryFxRate,
      為替基準日: 20260925,
      // 件数カード用の集計。注文照会の画面は使わないので省く（nullable）
      summary: null,
      orders: sorted.slice(offset, offset + limit),
    })
  }),

  /*
   * 1 件の詳細。同じ形のパス（/orders/csv-spec・/orders/dream-status など）も当たるので、
   * 数字でない ID は何も返さずに後ろのハンドラへ流す（MSW は undefined を「次へ」と扱う）。
   * 実 API の `order` は d_注文 の行に一覧と同じ派生項目を足したもの（toDetailOrder）。
   */
  http.get('*/api/orders/:orderId', ({ params }) => {
    if (!/^\d+$/.test(params.orderId)) return undefined

    const row = findRow(params.orderId)
    if (!row) return detailError(404, `指定された注文が存在しません: ID=${params.orderId}`)

    return HttpResponse.json({ order: toDetailOrder(row), executions: toExecutions(row), events: [] })
  }),

  http.post('*/api/orders/:orderId/amend', async ({ params, request }) => {
    const row = findRow(params.orderId)
    if (!row) return detailError(404, `指定された注文が存在しません: ID=${params.orderId}`)
    if (!AMENDABLE.includes(row.処理状況)) {
      return detailError(400, `この注文は訂正できません（処理状況: ${row.処理状況}）`)
    }

    const body = (await request.json().catch(() => null)) ?? {}
    const next = {
      数量: body.数量 ?? row.数量,
      指成区分: body.指成区分 ?? row.指成区分,
      指値単価: body.指値単価 ?? row.指値単価,
      発注範囲: body.発注範囲 ?? row.発注範囲,
    }
    // 成行へ変えたら単価は持たない
    if (next.指成区分 === 'MO') next.指値単価 = null

    const changed = Object.keys(next).some((key) => next[key] !== row[key])
    if (!changed) return detailError(400, '変更項目がありません')
    if (next.指成区分 === 'LO' && next.指値単価 == null) {
      return detailError(400, '指値注文には指値単価が必要です')
    }
    if (next.数量 <= row.出来数量) {
      return detailError(400, `訂正後の数量は出来数量（${row.出来数量}）より大きくしてください`)
    }

    // 未発注はその場で書き換える
    if (row.処理状況 === '000') {
      Object.assign(row, next, { 有効残数量: next.数量 - row.出来数量, 更新日時: nowIsoTimestamp() })
      return HttpResponse.json({
        success: true,
        mode: 'IN_PLACE',
        original_order_id: row.ID,
        amendment_order_id: null,
        status: row.処理状況,
        message: `注文を訂正しました（注文ID: ${row.ID}）`,
        warnings: [],
      })
    }

    // 発注済みは原注文を取消依頼にし、訂正注文（040）を足す。元注文ID は起点の注文を指す
    const amendmentId = Math.max(...rows.map((r) => r.ID)) + 1
    const amendment = {
      ...structuredClone(row),
      ...next,
      ID: amendmentId,
      元注文ID: row.元注文ID ?? row.ID,
      出来数量: 0,
      取消数量: null,
      有効残数量: next.数量 - row.出来数量,
      出来有無: false,
      集計対象: false,
      約定代金: null,
      約定代金_JPY: null,
      エラー内容: null,
    }
    setStatus(amendment, '040')
    setStatus(row, '030')
    rows.push(amendment)

    return HttpResponse.json({
      success: true,
      mode: 'CANCEL_REPLACE',
      original_order_id: row.ID,
      amendment_order_id: amendmentId,
      status: '040',
      message: `訂正注文を受け付けました（訂正注文ID: ${amendmentId}）`,
      warnings: [],
    })
  }),

  http.post('*/api/orders/:orderId/cancel', ({ params }) => {
    const row = findRow(params.orderId)
    // 実 API は取消の 404 を持たない（存在しない注文は ValueError → 400）
    if (!row) return detailError(400, `指定された注文が存在しません: ID=${params.orderId}`)

    if (CANCEL_NOW.includes(row.処理状況)) {
      setStatus(row, '034')
      return HttpResponse.json({
        success: true,
        order_id: row.ID,
        status: '034',
        message: `注文を取り消しました（注文ID: ${row.ID}）`,
        errors: [],
        warnings: [],
      })
    }

    if (CANCEL_REQUEST.includes(row.処理状況)) {
      setStatus(row, '030')
      return HttpResponse.json({
        success: true,
        order_id: row.ID,
        status: '030',
        message: `取消依頼を受け付けました（注文ID: ${row.ID}）`,
        errors: [],
        warnings: [],
      })
    }

    return detailError(400, `この注文は取消できません（処理状況: ${row.処理状況}）`)
  }),
]

import { http, HttpResponse } from 'msw'
import { customers } from '../fixtures/customers'
import { symbols } from '../fixtures/symbols'
import {
  CAUTION_COMPLIANCE_RANKS,
  FIRST_ORDER_ID,
  FLOCON_FX_RATE,
  LARGE_TRADE_THRESHOLD_JPY,
  orderMessages,
} from '../fixtures/orderEntry'
import { requestValidationError } from './_shared'

/*
 * 新規注文の事前検証（POST /orders/validate）と登録（POST /orders）。実 API と同じパス・同じ形で返す。
 *
 * 実 API はマスタ・残高・余力まで見るが、モックは画面の分岐を一通り出せるだけの規則に絞る。
 *   errors   … 口座が無い / 銘柄が無い / 取引不可の銘柄（規制情報 1）/ 買い × 成長投資枠 /
 *              VWAP 対象外の銘柄に VWAP
 *   warnings … 全取引停止の顧客 / コンプラランク A・B・Y・Z / 概算 5,000 万円超（大口取引）
 * 顧客と銘柄はフィクスチャの初期値で引く（マスタ画面で登録した行は対象外。画面をまたぐ再現は要らない）。
 *
 * 業務エラーは 200 で返す（valid:false / success:false）。実 API が 4xx で返すのかは未確定
 * （docs/api/requests.md #24）で、画面はどちらでも止まる作りにしてある。
 * 本文の必須項目が欠けたときだけ FastAPI と同じ 422 にする。
 */

let nextOrderId = FIRST_ORDER_ID

/** モックの可変状態（採番）を初期値に戻す */
export function resetOrderEntryState() {
  nextOrderId = FIRST_ORDER_ID
}

/** OrderRequest の required（openapi.json） */
const REQUIRED_KEYS = [
  '部店',
  '口座番号',
  '銘柄コード',
  '売買区分',
  '数量',
  '指成区分',
  '決済通貨区分',
  '証券受渡方法',
  '預り売買区分',
  '取引',
  '勧誘区分',
  '受注方法',
  '資金性格',
  '注文チャネル',
  '金銭受渡方法',
  '受注日',
  '受注時刻',
  '発注範囲',
  '作成者',
]

const SIDE_BUY = '3'
const DEPOSIT_GROWTH = '6'

/** 本文の必須項目の欠け（FastAPI の 422）。欠けが無ければ null */
function missingField(body) {
  const key = REQUIRED_KEYS.find((name) => body?.[name] === undefined || body?.[name] === null)
  return key ? requestValidationError(['body', key], 'Field required', 'missing') : null
}

/** 注文 1 件を検証する（事前検証と登録で同じ規則） */
function checkOrder(body) {
  const customer = customers.find(
    (row) => row.部店コード === body.部店 && row.口座番号 === body.口座番号,
  )
  const symbol = symbols.find((row) => row.銘柄コード === body.銘柄コード)

  const errors = []
  if (!customer) errors.push(orderMessages.customerNotFound)
  if (!symbol) errors.push(orderMessages.symbolNotFound)
  if (symbol?.規制情報 === '1') errors.push(orderMessages.prohibited)
  if (body.売買区分 === SIDE_BUY && body.預り売買区分 === DEPOSIT_GROWTH) {
    errors.push(orderMessages.growthOnBuy)
  }
  if (body.VWAP区分 === 1 && symbol && symbol.VWAP対象区分 !== '1') {
    errors.push(orderMessages.vwapNotTarget)
  }

  const warnings = []
  if (customer?.取引停止区分_全取引 === 1) warnings.push(orderMessages.tradingSuspended)
  if (customer && CAUTION_COMPLIANCE_RANKS.includes(customer.コンプラランク)) {
    warnings.push(orderMessages.complianceRank(customer.コンプラランク))
  }
  // 成行は前日終値で見積もる（モックのフロコン判定と同じく為替は固定）
  const unitPrice = body.指値単価 ?? symbol?.前日終値 ?? 0
  const amount = Math.round(body.数量 * unitPrice * FLOCON_FX_RATE)
  if (amount > LARGE_TRADE_THRESHOLD_JPY) warnings.push(orderMessages.largeTrade(amount))

  return { errors, warnings }
}

export const orderEntryHandlers = [
  http.post('*/api/orders/validate', async ({ request }) => {
    const body = await request.json()
    const missing = missingField(body)
    if (missing) return missing

    const { errors, warnings } = checkOrder(body)
    // 警告だけなら合格（強制区分の有無で返し方を変えない。進めるかどうかは画面が決める）
    return HttpResponse.json({ valid: errors.length === 0, errors, warnings, details: null })
  }),

  http.post('*/api/orders', async ({ request }) => {
    const body = await request.json()
    const missing = missingField(body)
    if (missing) return missing

    const { errors, warnings } = checkOrder(body)
    if (errors.length > 0) {
      return HttpResponse.json({
        success: false,
        order_id: null,
        message: orderMessages.rejected,
        errors,
        warnings,
      })
    }
    // 警告は強制区分を付けたときだけ突破できる
    if (warnings.length > 0 && body.強制区分 !== 1) {
      return HttpResponse.json({
        success: false,
        order_id: null,
        message: orderMessages.unacknowledgedWarnings,
        errors: [],
        warnings,
      })
    }

    const orderId = nextOrderId
    nextOrderId += 1
    return HttpResponse.json({
      success: true,
      order_id: orderId,
      message: orderMessages.created,
      errors: [],
      warnings,
    })
  }),
]

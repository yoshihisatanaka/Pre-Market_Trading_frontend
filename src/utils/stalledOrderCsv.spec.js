import { describe, expect, it } from 'vitest'
import { stalledOrderErrors } from '@/mocks/fixtures/stalledOrders'
import {
  CONFIRMATION_SAMPLE_CSV_FILENAME,
  TWS_ORDER_CSV_FILENAME,
  TWS_ORDER_SAMPLE_CSV_FILENAME,
  buildConfirmationSampleCsv,
  buildTwsOrderCsv,
  buildTwsOrderSampleCsv,
} from './stalledOrderCsv'

/*
 * 別システム（TWS）向けの CSV 3 種。期待する行は公開モックの実物（docs/unit/utils-stalled-order-csv.md）。
 * 入力はアプリ内モデル（src/api/stalledOrders.js の StalledOrder）で、フィクスチャの値から組み立てる。
 */
const CRLF = '\r\n'
const SIDES = { 1: 'sell', 3: 'buy' }

/** フィクスチャ（生の形）→ CSV が読む項目だけのアプリ内モデル */
const toModel = (raw) => ({
  id: String(raw.ID),
  accountNumber: String(raw.口座番号),
  symbol: raw.銘柄コード,
  side: SIDES[raw.売買区分] ?? '',
  quantity: raw.数量,
  orderType: raw.指成区分,
  limitPrice: raw.指値単価,
  marketCategoryName: raw.発注範囲名,
})

const byId = (id) => toModel(stalledOrderErrors.find((row) => row.ID === id))
const MARKET_ORDER = byId(27)
const LIMIT_ORDER = byId(26)

const TWS_HEADER =
  'order_id,account_number,symbol,action,quantity,order_type,limit_price,time_in_force,market_category'
const CONFIRMATION_HEADER =
  'order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message'

/** BOM を外して 1 行ずつに割る */
const lines = (text) => text.slice(1).split(CRLF).slice(0, -1)
const column = (line, name) => line.split(',')[TWS_HEADER.split(',').indexOf(name)]

// シナリオ: docs/unit/utils-stalled-order-csv.md
describe('utils/stalledOrderCsv', () => {
  it('[SOU-01] 発注 CSV のヘッダは TWS の 9 列', () => {
    expect(lines(buildTwsOrderCsv([MARKET_ORDER]))[0]).toBe(TWS_HEADER)
  })

  it('[SOU-02] 成行の注文は MKT で limit_price が空欄になる', () => {
    expect(lines(buildTwsOrderCsv([MARKET_ORDER]))[1]).toBe(
      '27,200001,MSFT,BUY,35,MKT,,DAY,レギュラー',
    )
  })

  it('[SOU-03] 指値の注文は LMT で指値をそのまま出す', () => {
    expect(lines(buildTwsOrderCsv([LIMIT_ORDER]))[1]).toBe('26,300001,AAPL,SELL,20,LMT,228.5,DAY,プレ')
  })

  it('[SOU-04] 未知の売買の向きは action を空欄にする', () => {
    const line = lines(buildTwsOrderCsv([{ ...LIMIT_ORDER, side: '' }]))[1]

    expect(column(line, 'action')).toBe('')
  })

  it('[SOU-05] 未知の指成区分は order_type を空欄にする', () => {
    const line = lines(buildTwsOrderCsv([{ ...LIMIT_ORDER, orderType: 'XX' }]))[1]

    expect(column(line, 'order_type')).toBe('')
  })

  it('[SOU-06] 0 件ならヘッダの 1 行だけになる', () => {
    expect(lines(buildTwsOrderCsv([]))).toEqual([TWS_HEADER])
  })

  it('[SOU-07] 行は渡した順に並ぶ', () => {
    const orders = [LIMIT_ORDER, MARKET_ORDER]

    expect(
      lines(buildTwsOrderCsv(orders))
        .slice(1)
        .map((line) => column(line, 'order_id')),
    ).toEqual(orders.map((order) => order.id))
  })

  it('[SOU-08] 発注 CSV のサンプルはヘッダと実物の 1 行', () => {
    expect(lines(buildTwsOrderSampleCsv())).toEqual([
      TWS_HEADER,
      '6,300003,AMZN,BUY,40,LMT,214.2500,DAY,プレ＋レギュラー',
    ])
  })

  it('[SOU-09] コンファメーション CSV のサンプルはヘッダと実物の 1 行', () => {
    expect(lines(buildConfirmationSampleCsv())).toEqual([
      CONFIRMATION_HEADER,
      '6,TWS-20260904-0006,CANCELLED,0,0,2026-09-04 10:15:00,TWSで取消確認',
    ])
  })

  it('[SOU-10] ファイル名は実物の 3 種', () => {
    expect(TWS_ORDER_CSV_FILENAME).toBe('tws_stalled_orders.csv')
    expect(TWS_ORDER_SAMPLE_CSV_FILENAME).toBe('tws_upload_sample.csv')
    expect(CONFIRMATION_SAMPLE_CSV_FILENAME).toBe('tws_confirmation_sample.csv')
  })
})

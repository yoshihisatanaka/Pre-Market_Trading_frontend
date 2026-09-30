import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { mizuhoClosingStatus } from '@/mocks/fixtures/closing'
import { mizuhoOrders } from '@/mocks/fixtures/mizuhoOrders'
import { ApiError } from './client'
import { closeMizuhoOrders } from './closing'
import { exportMizuhoOrderSheet } from './mizuho'

/*
 * API 層のテスト。オーダーシートの要求に載せるクエリと、xlsx の応答（本文とヘッダ）→ アプリ内モデルの変換を固定する。
 * 既定のハンドラ（src/mocks/handlers/mizuho.js）は締め済でないと 400 を返すので、成功を見るテストは先に締める。
 * 期待値はフィクスチャから数える。
 */
const EXPORT_PATH = '*/api/mizuho/export-orders'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const BASE_DATE = mizuhoClosingStatus.基準日

// 売りのブック: Dream 登録済（'2'）だけが載り、未登録の未出力（000）は数えて外す
const sellRows = mizuhoOrders.filter((row) => row.売買区分 === '1')
const sellRegistered = sellRows.filter((row) => row.Dream登録状況 === '2')
const sellUnregistered = sellRows.filter((row) => row.Dream登録状況 !== '2')

/** 最後に届いたリクエストのクエリ */
let lastParams = null

afterEach(() => {
  lastParams = null
})

/** クエリを記録して、既定のハンドラへ落とす */
function recordExport() {
  server.use(
    http.get(EXPORT_PATH, ({ request }) => {
      lastParams = new URL(request.url).searchParams
    }),
  )
}

// シナリオ: docs/unit/api-mizuho.md
describe('api/mizuho', () => {
  it('[MZO-01] side=buy で問い合わせ、ファイル名と xlsx の Blob を返す', async () => {
    await closeMizuhoOrders()
    recordExport()

    const sheet = await exportMizuhoOrderSheet({ side: 'buy' })

    expect(lastParams.get('side')).toBe('buy')
    expect(sheet.filename).toBe(`オーダーシート_${BASE_DATE}_BUY_US.xlsx`)
    expect(sheet.blob).toBeInstanceOf(Blob)
    expect(sheet.blob.type).toBe(XLSX)
  })

  it('[MZO-02] 件数ヘッダを数値にして返す', async () => {
    await closeMizuhoOrders()

    const sheet = await exportMizuhoOrderSheet({ side: 'sell' })

    expect(sheet.exportedCount).toBe(sellRegistered.length)
    expect(sheet.newlyExportedCount).toBe(sellRegistered.length)
    expect(sheet.skippedCount).toBe(sellUnregistered.length)
  })

  it('[MZO-03] 件数ヘッダと Content-Disposition が無ければ null と既定名にする', async () => {
    server.use(http.get(EXPORT_PATH, () => new HttpResponse(new Uint8Array([1, 2, 3]))))

    const sheet = await exportMizuhoOrderSheet({ side: 'sell' })

    expect(sheet.exportedCount).toBeNull()
    expect(sheet.newlyExportedCount).toBeNull()
    expect(sheet.skippedCount).toBeNull()
    expect(sheet.filename).toBe('オーダーシート_SELL_US.xlsx')
  })

  it('[MZO-04] 締める前は 400 の理由を持つ ApiError で reject する', async () => {
    const error = await exportMizuhoOrderSheet({ side: 'buy' }).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('注文ファイルは、みずほ注文締め後に作成してください。')
    expect(error.status).toBe(400)
  })
})

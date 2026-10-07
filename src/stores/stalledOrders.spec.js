import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { stalledOrderErrors, stalledWorkingOrders } from '@/mocks/fixtures/stalledOrders'
import { buildConfirmationSampleCsv } from '@/utils/stalledOrderCsv'
import { useStalledOrdersStore } from './stalledOrders'

const LIST_PATH = '*/api/operations/stalled-orders'
const IMPORT_PATH = '*/api/operations/stalled-orders/confirmation-import'

/*
 * jsdom の FormData は MSW(node) の XHR インターセプタが Fetch の Request に変換できず、
 * POST が応答しないまま止まる。テストの間だけ Node（undici）の FormData に差し替え、
 * 送る File も Node の実装で作る（詳細は src/api/stalledOrders.spec.js の冒頭）。
 */
let NodeFormData = null

beforeAll(async () => {
  const response = new Response('', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  NodeFormData = (await response.formData()).constructor
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('FormData', NodeFormData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// コンファメーション CSV のヘッダはサンプルの 1 行目から取る（列名を並べ書きしない）
const CONFIRMATION_HEADER = buildConfirmationSampleCsv().slice(1).split('\r\n')[0]
const confirmationFile = (lines) =>
  new NodeFile([[CONFIRMATION_HEADER, ...lines].join('\r\n')], 'confirmation.csv', {
    type: 'text/csv',
  })
const confirmationLine = (orderId, status) =>
  `${orderId},TWS-TEST-${orderId},${status},0,0,2026-09-16 11:00:00,テスト`

// 部店 123 の行（検索条件の引き継ぎを見るのに使う）
const BRANCH = '123'
const branchErrors = stalledOrderErrors.filter((row) => row.部店 === BRANCH)
// 部店 123 の注文エラーのうち 1 件を約定で消す
const CLOSED_TARGET = branchErrors[0]
// 滞留一覧に無い注文 ID（フィクスチャの最大値より大きい）
const UNKNOWN_ID = Math.max(...[...stalledOrderErrors, ...stalledWorkingOrders].map((r) => r.ID)) + 1

const ids = (orders) => orders.map((order) => order.id)
const rawIds = (rows) => rows.map((row) => String(row.ID))

/** 応答を握るハンドラ。呼ぶと応答が返る関数を返す */
function gate(method, path, body) {
  let release
  const opened = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async () => {
      await opened
      return HttpResponse.json(body)
    }),
  )
  return release
}

const emptyList = () => http.get(LIST_PATH, () => HttpResponse.json({ 注文エラー: [], 注文中: [] }))

/**
 * 取込の応答（CsvImportResponse の生の形）を差し込む。取込は実 API に素通しするので、
 * 呼ぶテストは必ずこれか個別の server.use で応答を用意する（onUnhandledRequest: 'error'）。
 *
 * @param {object} body 返す本文
 */
const importResponds = (body) => server.use(http.post(IMPORT_PATH, () => HttpResponse.json(body)))

// シナリオ: docs/unit/stores-stalled-orders.md
describe('useStalledOrdersStore', () => {
  it('[SOS-01] load 前は 2 本とも空配列', () => {
    const store = useStalledOrdersStore()

    expect(store.orderErrors).toEqual([])
    expect(store.workingOrders).toEqual([])
  })

  it('[SOS-02] load で 2 本がフィクスチャの件数で埋まる', async () => {
    const store = useStalledOrdersStore()

    await store.load()

    expect(ids(store.orderErrors)).toEqual(rawIds(stalledOrderErrors))
    expect(ids(store.workingOrders)).toEqual(rawIds(stalledWorkingOrders))
  })

  it('[SOS-03] 応答待ちの間は loading が true で空状態のフラグは立たない', async () => {
    const release = gate('get', LIST_PATH, { 注文エラー: [], 注文中: [] })
    const store = useStalledOrdersStore()

    const pending = store.load()

    expect(store.loading).toBe(true)
    expect(store.isOrderErrorsEmpty).toBe(false)
    expect(store.isWorkingOrdersEmpty).toBe(false)

    release()
    await pending
  })

  it('[SOS-04] 500 のとき error に理由が入り空状態のフラグは立たない', async () => {
    const message = 'サーバーでエラーが発生しました。'
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ detail: message }, { status: 500 })))
    const store = useStalledOrdersStore()

    await store.load()

    expect(store.error?.message).toBe(message)
    expect(store.isOrderErrorsEmpty).toBe(false)
    expect(store.isWorkingOrdersEmpty).toBe(false)
  })

  it('[SOS-05] 両方 0 件なら 2 つの空状態のフラグが立つ', async () => {
    server.use(emptyList())
    const store = useStalledOrdersStore()

    await store.load()

    expect(store.isOrderErrorsEmpty).toBe(true)
    expect(store.isWorkingOrdersEmpty).toBe(true)
  })

  it('[SOS-06] 注文エラーだけ 0 件なら注文エラーの空状態だけが立つ', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json({ 注文エラー: [], 注文中: stalledWorkingOrders })),
    )
    const store = useStalledOrdersStore()

    await store.load()

    expect(store.isOrderErrorsEmpty).toBe(true)
    expect(store.isWorkingOrdersEmpty).toBe(false)
  })

  it('[SOS-07] reload は直前の load と同じ条件で引き直す', async () => {
    const queries = []
    // 記録だけして既定のハンドラへ流す（resolver が何も返さなければ次のハンドラが応答する）
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        queries.push(Object.fromEntries(new URL(request.url).searchParams))
      }),
    )
    const store = useStalledOrdersStore()
    await store.load({ branchCode: BRANCH })

    await store.reload()

    expect(queries).toEqual([{ branch_code: BRANCH }, { branch_code: BRANCH }])
    expect(ids(store.orderErrors)).toEqual(rawIds(branchErrors))
  })

  it('[SOS-08] 失敗のあとの reload で error が消え結果が入れ替わる', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json({ detail: 'x' }, { status: 500 }), { once: true }),
    )
    const store = useStalledOrdersStore()
    await store.load()
    expect(store.error).not.toBeNull()

    await store.reload()

    expect(store.error).toBeNull()
    expect(ids(store.orderErrors)).toEqual(rawIds(stalledOrderErrors))
    expect(ids(store.workingOrders)).toEqual(rawIds(stalledWorkingOrders))
  })

  it('[SOS-09] 取込が成功すると直前の検索条件で引き直して結果を返す', async () => {
    const store = useStalledOrdersStore()
    await store.load({ branchCode: BRANCH })
    expect(ids(store.orderErrors)).toEqual(rawIds(branchErrors))

    // 取込の後の一覧は、約定した 1 件が消えた応答に差し替える（反映の中身はバックエンドの責務）
    const remaining = branchErrors.filter((row) => row !== CLOSED_TARGET)
    const queries = []
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        queries.push(Object.fromEntries(new URL(request.url).searchParams))
        return HttpResponse.json({ 注文エラー: remaining, 注文中: [] })
      }),
    )
    importResponds({
      success: true,
      total_count: 1,
      success_count: 1,
      error_count: 0,
      errors: [],
      message: 'コンファメーションを 1 件取り込みました。',
    })

    const result = await store.importConfirmation(
      confirmationFile([confirmationLine(CLOSED_TARGET.ID, 'FILLED')]),
    )

    expect(result).toMatchObject({ success: true, successCount: 1 })
    // 引き直しも部店 123 の条件で、差し替えた応答の内容が入る
    expect(queries).toEqual([{ branch_code: BRANCH }])
    expect(ids(store.orderErrors)).toEqual(rawIds(remaining))
    expect(store.workingOrders).toEqual([])
    expect(store.importError).toBeNull()
  })

  it('[SOS-10] 行エラーでも 200 なので引き直して結果を返す', async () => {
    const store = useStalledOrdersStore()
    await store.load()
    // 引き直しが起きたことを見分けられるよう、次の一覧は 0 件にしておく
    server.use(emptyList())
    const line = confirmationLine(UNKNOWN_ID, 'FILLED')
    importResponds({
      success: false,
      total_count: 1,
      success_count: 0,
      error_count: 1,
      errors: [
        {
          line_number: 2,
          errors: [`注文ID「${UNKNOWN_ID}」は滞留注文にありません。`],
          row_data: { order_id: String(UNKNOWN_ID), confirmation_status: 'FILLED' },
        },
      ],
      message: '1 行にエラーがあるため、取り込みませんでした。',
    })

    const result = await store.importConfirmation(confirmationFile([line]))

    expect(result.success).toBe(false)
    expect(result.errors.map((item) => item.orderId)).toEqual([String(UNKNOWN_ID)])
    expect(store.orderErrors).toEqual([])
    expect(store.workingOrders).toEqual([])
  })

  it('[SOS-11] 取込が 400 / 500 なら null を返し importError に理由が入り一覧は引き直さない', async () => {
    const store = useStalledOrdersStore()
    await store.load()
    const message = 'サーバーでエラーが発生しました。'
    server.use(
      emptyList(),
      http.post(IMPORT_PATH, () => HttpResponse.json({ detail: message }, { status: 500 })),
    )

    const result = await store.importConfirmation(confirmationFile([]))

    expect(result).toBeNull()
    expect(store.importError?.message).toBe(message)
    // 一覧の取得エラーには混ぜず、表示中の一覧もそのまま
    expect(store.error).toBeNull()
    expect(ids(store.orderErrors)).toEqual(rawIds(stalledOrderErrors))
    expect(ids(store.workingOrders)).toEqual(rawIds(stalledWorkingOrders))
  })

  it('[SOS-12] 取込の応答待ちの間は importing が true', async () => {
    const release = gate('post', IMPORT_PATH, {
      success: true,
      total_count: 0,
      success_count: 0,
      error_count: 0,
      errors: [],
      message: '',
    })
    const store = useStalledOrdersStore()

    const pending = store.importConfirmation(confirmationFile([]))

    expect(store.importing).toBe(true)

    release()
    await pending
    expect(store.importing).toBe(false)
  })

  it('[SOS-13] clearImportError で importError が消える', async () => {
    server.use(http.post(IMPORT_PATH, () => HttpResponse.json({ detail: 'x' }, { status: 400 })))
    const store = useStalledOrdersStore()
    await store.importConfirmation(confirmationFile([]))
    expect(store.importError).not.toBeNull()

    store.clearImportError()

    expect(store.importError).toBeNull()
  })
})

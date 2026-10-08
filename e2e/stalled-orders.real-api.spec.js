import { expect, test } from '@playwright/test'
import { apiContext, assertRealApi, logExchange, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 滞留注文抽出を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/stalled-orders-real-api.md（タイトル先頭の [SOR-xx] が対応 ID）
 *
 * stalled-orders.spec.js（SO）とは目的が違う。SO は MSW のモックに当てて画面の挙動を
 * 細かく固定する（注文エラー 2 件・注文中 2 件・#40 が先頭 …）。こちらはフロントとバックエンドの
 * 噛み合わせ（GET /orders の 2 回呼びのクエリ・multipart の取込・CsvImportResponse の変換）だけを見るので、
 * 期待値に**データの中身を書かない**（件数は画面と、画面自身が受け取った応答から読む）。
 *
 * 一覧の testid は `stalled-order-errors-*` / `stalled-working-orders-*` の 2 系統で、
 * ページャも `-table` 以外の共通の形も持たないため、helpers の listHelpers は使わずにここに書く。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test stalled-orders.real-api
 *
 * SOR-02 は実 API の取込（POST /operations/stalled-orders/confirmation-import）を叩くが、
 * 存在しない注文 ID の 1 行だけを送るので行エラーになり、全行ロールバックされる（openapi.json の説明）。
 * 実 DB の注文・約定は変わらない想定。ローカルの開発 DB 前提。
 */

const PATH = '/operations/stalled-orders'

// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const ORDERS_API_PATH = '/api/orders'
const IMPORT_API_PATH = '/api/operations/stalled-orders/confirmation-import'

/*
 * 2 本の一覧に載せる処理状況。src/api/stalledOrders.js の ORDER_ERROR_STATUSES / WORKING_STATUS の写し
 * （api 層は import.meta.env を辿る api/client.js に依存しており Playwright からは import できない）
 */
const ORDER_ERROR_STATUSES = '101,103'
const WORKING_STATUS = '003'

/** 2 つの一覧カード（testid の接頭辞は src/views/StalledOrderListView.vue の testid-prefix） */
const CARDS = [
  { prefix: 'stalled-order-errors', table: 'stalled-order-errors-table', status: ORDER_ERROR_STATUSES },
  {
    prefix: 'stalled-working-orders',
    table: 'stalled-working-orders-table',
    status: WORKING_STATUS,
  },
]

/** コンファメーション CSV のヘッダ（src/utils/stalledOrderCsv.js の CONFIRMATION_HEADER と同じ） */
const CONFIRMATION_HEADER =
  'order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message'

/*
 * 存在しない注文 ID。d_注文 の ID は採番の連番なので、ローカルの開発 DB でこの値には届かない。
 * int4 の上限（2147483647）未満に収め、型の検証（422）ではなく「知らない注文」の行エラーに落とす。
 * 念のため取込の前に GET /orders/{order_id} で存在しないことを確かめる。
 */
const UNKNOWN_ORDER_ID = 999999999

/*
 * 取込む 1 行。万一 ID が実在しても約定を足さない値にする（WORKING・約定数量 0。
 * filled_quantity は累計で、d_約定 の累計との差分だけを足す仕様なので 0 なら約定は増えない）。
 * 値にカンマは置かない。
 */
function confirmationCsv() {
  const line = [
    UNKNOWN_ORDER_ID,
    `E2E-SMOKE-${Date.now()}`,
    'WORKING',
    0,
    0,
    '2035-01-01 09:00:00',
    'E2E 実 API 接続確認（存在しない注文）',
  ].join(',')
  return `${CONFIRMATION_HEADER}\r\n${line}\r\n`
}

/** 画面が GET /orders を指定の status で呼んだ応答を待つ */
function waitForOrders(page, status) {
  return page.waitForResponse((res) => {
    const url = new URL(res.url())
    return (
      url.pathname === ORDERS_API_PATH &&
      res.request().method() === 'GET' &&
      url.searchParams.get('status') === status &&
      // 先頭のページ（全件取得のページ送りの 2 本目以降は見ない）
      (url.searchParams.get('offset') ?? '0') === '0'
    )
  })
}

/** 一覧を開き、2 本の GET /orders の応答と、2 つのカードの取得完了を待つ */
async function openList(page) {
  const responses = CARDS.map((card) => waitForOrders(page, card.status))
  await page.goto(PATH)
  const results = await Promise.all(responses)
  for (const card of CARDS) {
    await expect(page.getByTestId(`${card.prefix}-loading`)).toHaveCount(0)
  }
  await assertRealApi(page)
  return results
}

/** カードの「N 件」を読む */
async function countOf(page, prefix) {
  await expect(page.getByTestId(`${prefix}-count`)).toBeVisible()
  const text = await page.getByTestId(`${prefix}-count`).textContent()
  return Number(text.replace(/[^0-9]/g, ''))
}

/** 表の行。data-table-row は全画面共通の名前なのでこの画面のそれぞれの表にスコープを切る */
function rowsOf(page, table) {
  return page.getByTestId(table).getByTestId('data-table-row')
}

function fileInputOf(page) {
  return page.getByTestId('stalled-orders-confirmation-file').locator('input[type="file"]')
}

test.describe('滞留注文抽出（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[SOR-01] 実データで注文エラー / 注文中の 2 本の一覧がエラーなく表示される', async ({
    page,
  }) => {
    const responses = await openList(page)

    for (const [index, res] of responses.entries()) {
      const card = CARDS[index]
      expect(res.ok(), `GET /orders?status=${card.status} が ${res.status()} を返した`).toBe(true)
      const body = await res.json()
      expect(Array.isArray(body.orders), `status=${card.status} の応答に配列 orders が無い`).toBe(true)

      // ページャを持たない一覧なので、件数表示 = 表の行数 = サーバの total
      const total = await countOf(page, card.prefix)
      expect(total, `${card.prefix} の件数が応答の total と違う`).toBe(body.total)
      await expect(page.getByTestId(`${card.prefix}-error`)).toHaveCount(0)

      if (total > 0) {
        await expect(page.getByTestId(card.table)).toBeVisible()
        await expect(rowsOf(page, card.table)).toHaveCount(total)
        await expect(page.getByTestId(`${card.prefix}-empty`)).toHaveCount(0)
      } else {
        await expect(page.getByTestId(`${card.prefix}-empty`)).toBeVisible()
        await expect(page.getByTestId(card.table)).toHaveCount(0)
      }
    }
  })

  test('[SOR-02] 存在しない注文 ID のコンファメーション CSV は取り込まれず、行エラーか理由が出る', async ({
    page,
    playwright,
  }) => {
    // 取込の前に、その ID の注文が無いことを確かめる（あれば実 DB を書き換えうるので止める）
    const api = await apiContext(playwright)
    const exists = await api.get(`${ORDERS_API_PATH}/${UNKNOWN_ORDER_ID}`)
    await api.dispose()
    expect(
      exists.ok(),
      `注文 ${UNKNOWN_ORDER_ID} が実 DB にある。取込で書き換えうるので UNKNOWN_ORDER_ID を変えること`,
    ).toBe(false)

    await openList(page)
    const before = await Promise.all(CARDS.map((card) => countOf(page, card.prefix)))

    await fileInputOf(page).setInputFiles({
      name: 'confirmation-real-api.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(confirmationCsv(), 'utf-8'),
    })
    const importButton = page.getByTestId('stalled-orders-confirmation-import')
    await expect(importButton).toBeEnabled()

    const response = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === IMPORT_API_PATH && res.request().method() === 'POST',
    )
    await importButton.click()
    const res = await response
    const text = await logExchange('SOR-02', res)

    // multipart で file を送っている（境界はブラウザが付ける）
    expect(res.request().headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    /*
     * 仕様（openapi.json）では知らない注文 ID は 200 の行エラーで返る。4xx は通さない:
     * 400 は空ファイル・ヘッダ不一致なので CSV の形が噛み合っていない、422 は multipart の項目名や
     * X-User-Code が噛み合っていない、404 は仕様に無い応答。どれも噛み合わせの不具合として落とす
     */
    expect(res.status(), `取込が 200 ではなく ${res.status()} を返した: ${text}`).toBe(200)

    const body = JSON.parse(text)
    expect(body.success, '存在しない注文 ID が取り込まれた').toBe(false)
    expect(body.success_count).toBe(0)
    expect(body.errors?.length, '行エラーが返っていない').toBeGreaterThan(0)

    // 成功の通知は出ない
    await expect(page.getByTestId('stalled-orders-import-notice')).toHaveCount(0)
    // 取り込めていないのでファイルは選ばれたまま
    await expect(page.getByTestId('stalled-orders-confirmation-file')).toContainText(
      'confirmation-real-api.csv',
    )

    const errors = page.getByTestId('stalled-orders-import-errors')
    await expect(errors).toBeVisible()
    const rows = errors.getByTestId('data-table-row')
    await expect(rows).toHaveCount(body.errors.length)

    // 1 行目は CSV の 2 行目（ヘッダが 1 行目）で、注文 ID は送った値。文言はサーバが決めるので固定しない
    const [first] = body.errors
    expect(first.line_number).toBe(2)
    const cells = rows.first().getByRole('cell')
    await expect(cells.nth(0)).toHaveText(String(first.line_number))
    const sentId = first.row_data?.order_id
    await expect(cells.nth(1)).toHaveText(sentId == null ? '—' : String(sentId))
    if (sentId != null) expect(String(sentId)).toBe(String(UNKNOWN_ORDER_ID))
    await expect(cells.nth(2)).not.toHaveText('')

    // 一覧は取込の前と同じ件数のまま（何も反映されていない）
    for (const [index, card] of CARDS.entries()) {
      expect(await countOf(page, card.prefix)).toBe(before[index])
    }
  })
})

import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  ORDER_CSV_CASH_SHORT_QUANTITY,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvSampleOrders,
  orderCsvTemplateText,
  orderCsvValidateForceableResponse,
  orderCsvValidateResponse,
  orderCsvValidateWithErrorsResponse,
} from '@/mocks/fixtures/orderCsv'
import { useOrderCsvStore } from '@/stores/orderCsv'
import { formatCompactMonthDay, formatQuantity } from '@/utils/format'
import { EXECUTION_SCOPE_LABELS, codeLabel, orderPriceLabel } from '@/utils/orderCodeLabels'
import OrderCsvPreviewView from './OrderCsvPreviewView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、事前検証の結果の出し分けと
 * 一括受付への導線を検証する。前提はストアの validateFile で作ってからマウントする
 * （この画面は読み込みを持たず、取込み画面で済ませた結果を出すだけ）。
 */
const VALIDATE_PATH = '*/api/orders/validate-csv'
const BULK_PATH = '*/api/orders/bulk-create'
const DETAIL = 'サーバーでエラーが発生しました。'

/*
 * 事前検証は multipart。jsdom の FormData は MSW(node) を通らないので、テストの間だけ
 * Node（undici）の FormData に差し替え、File も Node の実装にする（src/api/stalledOrders.spec.js と同じ）。
 */
let NodeFormData = null

beforeAll(async () => {
  const response = new Response('', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  NodeFormData = (await response.formData()).constructor
})

beforeEach(() => {
  vi.stubGlobal('FormData', NodeFormData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const csvFile = (text) => new NodeFile([text], 'orders.csv', { type: 'text/csv' })
const templateFile = () => csvFile(orderCsvTemplateText)

/** 注文の行（生の形）から CSV の本文を組む（null は空欄） */
const csvOf = (orders) =>
  [
    orderCsvColumnNames.join(','),
    ...orders.map((order) =>
      orderCsvColumnNames.map((name) => (order[name] == null ? '' : String(order[name]))).join(','),
    ),
  ].join('\r\n') + '\r\n'

/** 正常の行と、強制で救える行（MSW の仮規則で買付余力不足）だけの CSV */
const FORCEABLE_ORDERS = [
  orderCsvSampleOrders[0],
  { ...orderCsvSampleOrders[0], 数量: ORDER_CSV_CASH_SHORT_QUANTITY },
]
const forceableFile = () => csvFile(csvOf(FORCEABLE_ORDERS))

/** 売買区分のコード → 名前（フィクスチャの allowed_values） */
const SIDE_NAMES = Object.fromEntries(
  orderCsvColumns
    .find((column) => column.name === '売買区分')
    .allowed_values.map(({ code, label }) => [code, label]),
)

/** データ行が 0 件の事前検証の応答 */
const NO_ROWS_RESPONSE = {
  total_count: 0,
  valid_count: 0,
  invalid_count: 0,
  all_valid: false,
  has_error: false,
  rows: [],
}

const Page = { render: () => h('div') }

/**
 * ストアに前提を作る。response を渡せば事前検証の応答をそれにする。validate: false なら検証しない。
 * @returns {Promise<{ pinia: import('pinia').Pinia, store: ReturnType<typeof useOrderCsvStore> }>}
 */
async function prepare({ response = null, validate = true, file = templateFile } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useOrderCsvStore(pinia)
  if (response) server.use(http.post(VALIDATE_PATH, () => HttpResponse.json(response)))
  if (validate) await store.validateFile(file())
  return { pinia, store }
}

async function mountView(pinia) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/orders/csv/upload', name: 'order-csv-upload', component: Page },
      { path: '/orders/csv/preview', name: 'order-csv-preview', component: Page },
      { path: '/orders/csv/complete', name: 'order-csv-complete', component: Page },
      { path: '/orders/dream-status', name: 'dream-status-list', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ name: 'order-csv-preview' })

  const wrapper = mount(OrderCsvPreviewView, {
    global: {
      plugins: [pinia, router],
      stubs: { teleport: true },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const table = (wrapper) => byTestid(wrapper, 'order-csv-preview-table')
const rows = (wrapper) => table(wrapper).findAll('[data-testid="data-table-row"]')
const headers = (wrapper) => table(wrapper).findAll('th').map((th) => th.text())
/** 行の中の、見出しが label の列のセル */
const cell = (wrapper, row, label) => row.findAll('td')[headers(wrapper).indexOf(label)]
const submitButton = (wrapper) => byTestid(wrapper, 'order-csv-preview-submit')

/** 見本（orderCsvValidateForceableResponse）の、強制で救える NG の行と救えない NG の行の位置 */
const FORCEABLE_INDEX = orderCsvValidateForceableResponse.rows.findIndex(
  (raw) => raw.valid !== true && raw.forceable === true,
)
const NOT_FORCEABLE_INDEX = orderCsvValidateForceableResponse.rows.findIndex(
  (raw) => raw.valid !== true && raw.forceable !== true,
)

/** 強制のチェックがある行の位置（MSW に検証させた CSV 用） */
const forceableRowIndex = (wrapper) =>
  rows(wrapper).findIndex((row) => row.find('[data-testid="order-csv-preview-force"]').exists())

/** index 行目の強制のチェックを付ける / 外す */
async function checkForce(wrapper, index, checked) {
  await rows(wrapper)[index].find('[data-testid="order-csv-preview-force"]').setValue(checked)
  await flushPromises()
}

/**
 * 一括受付の応答を握るハンドラ。release() を呼ぶまで応答せず、そのあと既定のハンドラに回す。
 * @returns {() => void}
 */
function holdBulk() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.post(BULK_PATH, async () => {
      await gate
    }),
  )
  return release
}

const bulkErrorHandler = () =>
  http.post(BULK_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 }))

// シナリオ: docs/unit/views-order-csv-preview-view.md
describe('OrderCsvPreviewView', () => {
  it('[OCP-01] 検証結果が無いと空状態だけを出す', async () => {
    const { pinia } = await prepare({ validate: false })
    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-preview-empty')).toBe(true)
    expect(exists(wrapper, 'order-csv-preview-table')).toBe(false)
    expect(exists(wrapper, 'order-csv-preview-total')).toBe(false)
    expect(exists(wrapper, 'order-csv-preview-submit')).toBe(false)
  })

  it('[OCP-02] 空状態の「CSV取込みへ」で取込みへ移る', async () => {
    const { pinia } = await prepare({ validate: false })
    const { wrapper, router } = await mountView(pinia)

    await byTestid(wrapper, 'order-csv-preview-to-upload').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('order-csv-upload')
  })

  it('[OCP-03] 全行 OK のとき件数を出し、エラー枠は緑でエラーの帯は出ない', async () => {
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)

    expect(byTestid(wrapper, 'order-csv-preview-total').text()).toContain(
      formatQuantity(orderCsvValidateResponse.total_count),
    )
    expect(byTestid(wrapper, 'order-csv-preview-valid').text()).toContain(
      formatQuantity(orderCsvValidateResponse.valid_count),
    )
    const invalid = byTestid(wrapper, 'order-csv-preview-invalid')
    expect(invalid.text()).toContain(formatQuantity(orderCsvValidateResponse.invalid_count))
    expect(invalid.find('.is-ok').exists()).toBe(true)
    expect(invalid.find('.is-ng').exists()).toBe(false)
    expect(exists(wrapper, 'order-csv-preview-has-error')).toBe(false)
  })

  it('[OCP-04] データ行が 0 件のとき表の代わりに文言を出し、受付できない', async () => {
    const { pinia } = await prepare({ response: NO_ROWS_RESPONSE })
    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-preview-no-rows')).toBe(true)
    expect(exists(wrapper, 'order-csv-preview-table')).toBe(false)
    expect(submitButton(wrapper).text()).toBe('受付できる注文がありません')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('[OCP-05] NG を含むときエラーの帯を出し、NG の行だけ赤くする', async () => {
    const { pinia } = await prepare({ response: orderCsvValidateWithErrorsResponse })
    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-preview-has-error')).toBe(true)
    const invalid = byTestid(wrapper, 'order-csv-preview-invalid')
    expect(invalid.find('.is-ng').exists()).toBe(true)
    const raws = orderCsvValidateWithErrorsResponse.rows
    expect(rows(wrapper)).toHaveLength(raws.length)
    rows(wrapper).forEach((row, index) => {
      expect(row.classes().includes('is-invalid')).toBe(raws[index].valid !== true)
    })
  })

  it('[OCP-06] エラーと警告を別々に、行ごとの件数と文言どおりに出す', async () => {
    const { pinia } = await prepare({ response: orderCsvValidateWithErrorsResponse })
    const { wrapper } = await mountView(pinia)
    const raws = orderCsvValidateWithErrorsResponse.rows
    // 前提: エラーのある行と警告のある行がフィクスチャにある
    expect(raws.some((raw) => raw.errors.length > 0)).toBe(true)
    expect(raws.some((raw) => raw.warnings.length > 0)).toBe(true)

    rows(wrapper).forEach((row, index) => {
      const errors = row.findAll('[data-testid="order-csv-preview-error"]')
      const warnings = row.findAll('[data-testid="order-csv-preview-warning"]')
      expect(errors).toHaveLength(raws[index].errors.length)
      expect(warnings).toHaveLength(raws[index].warnings.length)
      errors.forEach((item, at) => {
        expect(item.classes()).toContain('is-error')
        expect(item.text()).toContain(raws[index].errors[at])
      })
      warnings.forEach((item, at) => {
        expect(item.classes()).toContain('is-warning')
        expect(item.text()).toContain(raws[index].warnings[at])
      })
    })
  })

  it('[OCP-07] 行のセルに口座・売買・価格・市場区分・期間指定を整形して出す', async () => {
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)

    expect(rows(wrapper)).toHaveLength(orderCsvSampleOrders.length)
    rows(wrapper).forEach((row, index) => {
      const raw = orderCsvSampleOrders[index]
      expect(cell(wrapper, row, '口座番号').text()).toBe(`${raw.部店}-${raw.口座番号}`)
      expect(cell(wrapper, row, '売買').text()).toBe(SIDE_NAMES[raw.売買区分])
      expect(cell(wrapper, row, '価格').text()).toBe(
        orderPriceLabel({ orderType: raw.指成区分, limitPrice: raw.指値単価 }),
      )
      expect(cell(wrapper, row, '市場区分').text()).toBe(
        codeLabel(EXECUTION_SCOPE_LABELS, raw.発注範囲),
      )
      expect(cell(wrapper, row, '期間指定').text()).toBe(formatCompactMonthDay(raw.有効期限))
    })
  })

  it('[OCP-08] 全行 OK のとき「N件を受付する」で押せる', async () => {
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)

    expect(submitButton(wrapper).text()).toBe(`${orderCsvValidateResponse.total_count}件を受付する`)
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('[OCP-09] NG を含むとき「エラーを修正してください」で押せない', async () => {
    const { pinia } = await prepare({ response: orderCsvValidateWithErrorsResponse })
    const { wrapper } = await mountView(pinia)

    expect(submitButton(wrapper).text()).toBe('エラーを修正してください')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('[OCP-10] 受付すると受付完了へ移り、ストアに結果が入る', async () => {
    const { pinia, store } = await prepare()
    const { wrapper, router } = await mountView(pinia)

    await submitButton(wrapper).trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-csv-complete'))

    expect(store.completion).not.toBeNull()
    expect(store.completion.rows).toHaveLength(orderCsvSampleOrders.length)
  })

  it('[OCP-11] 一括受付が 500 のときプレビューに留まり、理由を出して押し直せる', async () => {
    server.use(bulkErrorHandler())
    const { pinia } = await prepare()
    const { wrapper, router } = await mountView(pinia)

    await submitButton(wrapper).trigger('click')
    await vi.waitFor(() => expect(exists(wrapper, 'order-csv-preview-submit-error')).toBe(true))

    expect(byTestid(wrapper, 'order-csv-preview-submit-error').text()).toContain(DETAIL)
    expect(router.currentRoute.value.name).toBe('order-csv-preview')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('[OCP-12] 受付の応答を待つ間は受付ボタンが押せない', async () => {
    const release = holdBulk()
    const { pinia } = await prepare()
    const { wrapper, router } = await mountView(pinia)

    await submitButton(wrapper).trigger('click')

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    release()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-csv-complete'))
  })

  it('[OCP-13] 前回の受付のエラーはマウントし直すと出ない', async () => {
    server.use(bulkErrorHandler())
    const { pinia, store } = await prepare()
    await store.submitOrders()
    // 前提: 受付のエラーがストアに残っている
    expect(store.submitError).not.toBeNull()

    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-preview-submit-error')).toBe(false)
  })

  it('[OCP-14] どちらの再取込みボタンでも取込みへ移る', async () => {
    const { pinia } = await prepare()
    const { wrapper, router } = await mountView(pinia)

    for (const testid of ['order-csv-preview-reupload', 'order-csv-preview-back']) {
      await router.push({ name: 'order-csv-preview' })

      await byTestid(wrapper, testid).trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('order-csv-upload')
    }
  })

  it('[OCP-15] 救える NG の行にだけ強制のチェックを出し、救えない行は「不可」、正常の行は「—」', async () => {
    const { pinia } = await prepare({ response: orderCsvValidateForceableResponse })
    const { wrapper } = await mountView(pinia)
    const raws = orderCsvValidateForceableResponse.rows
    // 前提: 正常・救える・救えないの 3 種が見本にある
    expect(FORCEABLE_INDEX).toBeGreaterThanOrEqual(0)
    expect(NOT_FORCEABLE_INDEX).toBeGreaterThanOrEqual(0)
    expect(raws.some((raw) => raw.valid)).toBe(true)

    expect(rows(wrapper)).toHaveLength(raws.length)
    rows(wrapper).forEach((row, index) => {
      const raw = raws[index]
      const forced = cell(wrapper, row, '強制')
      const checkbox = forced.find('[data-testid="order-csv-preview-force"]')
      const notForceable = forced.find('[data-testid="order-csv-preview-not-forceable"]')
      if (index === FORCEABLE_INDEX) {
        expect(checkbox.exists()).toBe(true)
        expect(checkbox.attributes('type')).toBe('checkbox')
        expect(checkbox.attributes('aria-label')).toBe(`${raw.row_number}行目を強制する`)
        expect(checkbox.element.checked).toBe(false)
        expect(forced.text()).toBe('強制')
        expect(notForceable.exists()).toBe(false)
      } else if (raw.valid) {
        expect(checkbox.exists()).toBe(false)
        expect(notForceable.exists()).toBe(false)
        expect(forced.text()).toBe('—')
      } else {
        expect(checkbox.exists()).toBe(false)
        expect(notForceable.text()).toBe('不可')
      }
    })
  })

  it('[OCP-16] チェックを付けると行が強制になり、救えない行は NG のまま', async () => {
    const { pinia, store } = await prepare({ response: orderCsvValidateForceableResponse })
    const { wrapper } = await mountView(pinia)

    await checkForce(wrapper, FORCEABLE_INDEX, true)

    expect(store.isForced(store.validation.rows[FORCEABLE_INDEX])).toBe(true)
    const forcedRow = rows(wrapper)[FORCEABLE_INDEX]
    expect(cell(wrapper, forcedRow, '状態').text()).toBe('強制')
    expect(forcedRow.classes()).toContain('is-forced')
    expect(forcedRow.classes()).not.toContain('is-invalid')
    const ngRow = rows(wrapper)[NOT_FORCEABLE_INDEX]
    expect(cell(wrapper, ngRow, '状態').text()).toBe('NG')
    expect(ngRow.classes()).toContain('is-invalid')
  })

  it('[OCP-17] 救えない NG の行が残るとエラーの帯のままで受付できない', async () => {
    const { pinia } = await prepare({ response: orderCsvValidateForceableResponse })
    const { wrapper } = await mountView(pinia)

    await checkForce(wrapper, FORCEABLE_INDEX, true)

    expect(exists(wrapper, 'order-csv-preview-has-error')).toBe(true)
    expect(exists(wrapper, 'order-csv-preview-forced-notice')).toBe(false)
    expect(submitButton(wrapper).text()).toBe('エラーを修正してください')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('[OCP-18] NG をすべて強制で救うと強制の帯が出て、強制の件数付きで受付できる', async () => {
    const { pinia } = await prepare({ file: forceableFile })
    const { wrapper } = await mountView(pinia)
    const index = forceableRowIndex(wrapper)
    // 前提: チェックを付ける前は受付できない
    expect(exists(wrapper, 'order-csv-preview-has-error')).toBe(true)
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await checkForce(wrapper, index, true)

    expect(exists(wrapper, 'order-csv-preview-has-error')).toBe(false)
    expect(byTestid(wrapper, 'order-csv-preview-forced-notice').text()).toContain(
      '1件を強制で受付します。',
    )
    expect(submitButton(wrapper).text()).toBe(
      `${FORCEABLE_ORDERS.length}件を受付する（うち強制1件）`,
    )
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('[OCP-19] 強制を付けて受付すると受付完了へ移り、警告に強制した行の行番号が入る', async () => {
    const { pinia, store } = await prepare({ file: forceableFile })
    const { wrapper, router } = await mountView(pinia)
    const index = forceableRowIndex(wrapper)
    const rowNumber = store.validation.rows[index].rowNumber
    await checkForce(wrapper, index, true)

    await submitButton(wrapper).trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-csv-complete'))

    expect(store.completion.warnings.map((warning) => warning.rowNumber)).toEqual([rowNumber])
  })

  it('[OCP-20] チェックを外すと NG に戻り、受付できなくなる', async () => {
    const { pinia } = await prepare({ file: forceableFile })
    const { wrapper } = await mountView(pinia)
    const index = forceableRowIndex(wrapper)
    await checkForce(wrapper, index, true)

    await checkForce(wrapper, index, false)

    const row = rows(wrapper)[index]
    expect(row.classes()).toContain('is-invalid')
    expect(cell(wrapper, row, '状態').text()).toBe('NG')
    expect(exists(wrapper, 'order-csv-preview-has-error')).toBe(true)
    expect(submitButton(wrapper).text()).toBe('エラーを修正してください')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })
})

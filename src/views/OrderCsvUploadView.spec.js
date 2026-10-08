import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  ORDER_CSV_TEMPLATE_FILENAME,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvRequiredHeaderNames,
  orderCsvSampleOrders,
  orderCsvTemplateText,
  orderCsvValidateResponse,
} from '@/mocks/fixtures/orderCsv'
import { useOrderCsvStore } from '@/stores/orderCsv'
import { downloadBlob } from '@/utils/download'
import OrderCsvUploadView from './OrderCsvUploadView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 「CSVフォーマット」表の 4 状態と取込み口の活性、テンプレートDL と事前検証の導線を検証する。
 *
 * jsdom は URL.createObjectURL を持たないので、保存そのものは vi.mock で差し替えて「何を渡したか」を見る。
 */
vi.mock('@/utils/download', () => ({ downloadBlob: vi.fn(), downloadCsv: vi.fn() }))

const SPEC_PATH = '*/api/orders/csv-spec'
const TEMPLATE_PATH = '*/api/orders/csv-template'
const VALIDATE_PATH = '*/api/orders/validate-csv'
const DETAIL = 'サーバーでエラーが発生しました。'

/*
 * 事前検証は multipart。jsdom の FormData は MSW(node) を通らないので、テストの間だけ
 * Node（undici）の FormData に差し替え、ドロップするファイルも Node の File にする
 * （src/api/stalledOrders.spec.js と同じ）。
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
  downloadBlob.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const csvFile = (text, name = 'orders.csv') => new NodeFile([text], name, { type: 'text/csv' })

/** 1 件の注文（生の形）を CSV の 1 行にする（null は空欄） */
const toCsvLine = (order) =>
  orderCsvColumnNames.map((name) => (order[name] == null ? '' : String(order[name]))).join(',')

/** NG の行（指値なのに指値単価が無い）を含む CSV */
const INVALID_CSV = [
  orderCsvColumnNames.join(','),
  toCsvLine({ ...orderCsvSampleOrders[0], 指成区分: 'LO', 指値単価: null }),
].join('\r\n')

/** ヘッダーの列が足りない CSV（先頭 2 列だけ）と、そのとき handler が返す detail */
const SHORT_HEADER = orderCsvColumnNames.slice(0, 2)
const SHORT_HEADER_CSV = `${SHORT_HEADER.join(',')}\r\n`
const SHORT_HEADER_DETAIL = `CSVヘッダーに不足があります: 不足項目=[${orderCsvRequiredHeaderNames
  .filter((name) => !SHORT_HEADER.includes(name))
  .map((name) => `'${name}'`)
  .join(', ')}]`

/** jsdom の Blob を文字列で読む（readAsText は BOM を落とすので、比べる側も復号して揃える） */
const readBlob = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
const decoded = (text) => new TextDecoder().decode(new TextEncoder().encode(text))

/**
 * 応答を握るハンドラ。release() を呼ぶまで応答せず、そのあと既定のハンドラに回す。
 * @returns {() => void}
 */
function holdRequest(method, path) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async () => {
      await gate
    }),
  )
  return release
}

// 期待値はフィクスチャから導く（22 列・列名・必須の内訳を直接書かない）
const byIndex = [...orderCsvColumns].sort((a, b) => a.index - b.index)
const conditioned = byIndex.filter((column) => column.condition)
const optional = byIndex.filter((column) => column.required !== true)

const Page = { render: () => h('div') }

/** @param {{ pinia?: import('pinia').Pinia }} [options] 前提をストアに作っておくときは同じ Pinia を渡す */
async function mountView({ pinia = createPinia() } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/orders/csv/upload', name: 'order-csv-upload', component: Page },
      { path: '/orders/csv/preview', name: 'order-csv-preview', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ name: 'order-csv-upload' })

  const wrapper = mount(OrderCsvUploadView, {
    global: {
      plugins: [pinia, router],
      stubs: { teleport: true },
    },
  })
  return { wrapper, router, store: useOrderCsvStore(pinia) }
}

/** 取込み口に CSV をドロップして「内容を確認する」を押す */
async function dropAndConfirm(wrapper, file) {
  await byTestid(wrapper, 'order-csv-file').trigger('drop', { dataTransfer: { files: [file] } })
  await byTestid(wrapper, 'order-csv-confirm').trigger('click')
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const table = (wrapper) => byTestid(wrapper, 'order-csv-format-table')
const rows = (wrapper) => table(wrapper).findAll('[data-testid="data-table-row"]')
const headers = (wrapper) => table(wrapper).findAll('th').map((th) => th.text())
/** 行の中の、見出しが label の列のセル */
const cell = (wrapper, row, label) => row.findAll('td')[headers(wrapper).indexOf(label)]
/** 行に出ている列名からフィクスチャの列を引く */
const rawOf = (wrapper, row) =>
  byIndex.find((column) => column.name === cell(wrapper, row, '列名').text())

const errorHandler = () =>
  http.get(SPEC_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 }))

/**
 * 取得を握るハンドラ。release() を呼ぶまで応答しない。
 * @returns {() => void}
 */
function holdHandler() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get(SPEC_PATH, async () => {
      await gate
      return HttpResponse.json({ total_columns: 0, columns: [] })
    }),
  )
  return release
}

// シナリオ: docs/unit/views-order-csv-upload-view.md
describe('OrderCsvUploadView', () => {
  it('[OCU-01] 応答待ちのあいだはローディングだけを出す', async () => {
    const release = holdHandler()
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'order-csv-format-loading')).toBe(true)
    expect(exists(wrapper, 'order-csv-format-table')).toBe(false)
    expect(exists(wrapper, 'order-csv-format-empty')).toBe(false)
    expect(exists(wrapper, 'order-csv-format-error')).toBe(false)

    release()
    await flushPromises()
  })

  it('[OCU-02] 500 のとき理由と「再試行」を出し、表と凡例は出さない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await flushPromises()

    const error = byTestid(wrapper, 'order-csv-format-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(DETAIL)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'order-csv-format-table')).toBe(false)
    expect(exists(wrapper, 'order-csv-format-legend')).toBe(false)
    expect(exists(wrapper, 'order-csv-format-loading')).toBe(false)
  })

  it('[OCU-03] 「再試行」で読み直すと表が出る', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await flushPromises()

    server.resetHandlers()
    await byTestid(wrapper, 'order-csv-format-error').find('button').trigger('click')
    await flushPromises()

    expect(exists(wrapper, 'order-csv-format-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(orderCsvColumns.length)
  })

  it('[OCU-04] 0 列のとき空の文言を出し、表と凡例は出さない', async () => {
    server.use(http.get(SPEC_PATH, () => HttpResponse.json({ total_columns: 0, columns: [] })))
    const { wrapper } = await mountView()
    await flushPromises()

    expect(byTestid(wrapper, 'order-csv-format-empty').text()).toBe(
      'CSVフォーマットの定義がありません',
    )
    expect(exists(wrapper, 'order-csv-format-table')).toBe(false)
    expect(exists(wrapper, 'order-csv-format-legend')).toBe(false)
  })

  it('[OCU-05] 凡例と、全列を index 順に並べた表を出す', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    expect(exists(wrapper, 'order-csv-format-legend')).toBe(true)
    expect(rows(wrapper)).toHaveLength(orderCsvColumns.length)
    expect(rows(wrapper).map((row) => cell(wrapper, row, '列名').text())).toEqual(
      byIndex.map((column) => column.name),
    )
  })

  it('[OCU-06] 必須の列だけ列名を赤字にする', async () => {
    // 前提: 任意の列がフィクスチャにある（指値単価）
    expect(optional.length).toBeGreaterThan(0)
    const { wrapper } = await mountView()
    await flushPromises()

    for (const row of rows(wrapper)) {
      const raw = rawOf(wrapper, row)
      const name = cell(wrapper, row, '列名').find('span')
      expect(name.classes().includes('order-csv-upload__required')).toBe(raw.required === true)
    }
  })

  it('[OCU-07] 必須欄は ● と「必須」、任意は — と「任意」を出す', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    for (const row of rows(wrapper)) {
      const raw = rawOf(wrapper, row)
      const mark = cell(wrapper, row, '必須')
      expect(mark.find('[aria-hidden="true"]').text()).toBe(raw.required ? '●' : '—')
      expect(mark.text()).toContain(raw.required ? '必須' : '任意')
      expect(mark.text()).not.toContain(raw.required ? '任意' : '必須')
    }
  })

  it('[OCU-08] condition のある列だけ説明の下に条件を添える', async () => {
    expect(conditioned.length).toBeGreaterThan(0)
    const { wrapper } = await mountView()
    await flushPromises()

    for (const row of rows(wrapper)) {
      const raw = rawOf(wrapper, row)
      const description = cell(wrapper, row, '説明')
      if (raw.condition) {
        expect(description.text()).toContain(raw.description)
        expect(description.text()).toContain(raw.condition)
      } else {
        expect(description.text()).toBe(raw.description)
      }
    }
  })

  it('[OCU-09] 例の欄に例を文字列のまま出す', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    for (const row of rows(wrapper)) {
      const raw = rawOf(wrapper, row)
      expect(cell(wrapper, row, '例').text()).toBe(String(raw.example))
    }
  })

  it('[OCU-10] ファイル未選択では「内容を確認する」が押せない', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    const confirm = byTestid(wrapper, 'order-csv-confirm')
    expect(confirm.text()).toBe('内容を確認する')
    expect(confirm.attributes('disabled')).toBeDefined()
  })

  it('[OCU-11] CSV をドロップするとファイル名が出て「内容を確認する」が押せる', async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    const file = new File(['部店,口座番号'], 'orders.csv', { type: 'text/csv' })

    await byTestid(wrapper, 'order-csv-file').trigger('drop', { dataTransfer: { files: [file] } })

    expect(byTestid(wrapper, 'order-csv-file').text()).toContain(file.name)
    expect(byTestid(wrapper, 'order-csv-confirm').attributes('disabled')).toBeUndefined()
  })

  it('[OCU-12] 「テンプレートDL」ボタンが押せる状態で出る', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    const template = byTestid(wrapper, 'order-csv-template')
    expect(template.exists()).toBe(true)
    expect(template.text()).toBe('テンプレートDL')
    expect(template.attributes('disabled')).toBeUndefined()
  })

  it('[OCU-13] 「テンプレートDL」でサーバのファイル名とテンプレートの Blob を保存させる', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    await byTestid(wrapper, 'order-csv-template').trigger('click')
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))

    const [filename, blob] = downloadBlob.mock.calls[0]
    expect(filename).toBe(ORDER_CSV_TEMPLATE_FILENAME)
    expect(await readBlob(blob)).toBe(decoded(orderCsvTemplateText))
  })

  it('[OCU-14] テンプレートの取得中は「テンプレートDL」が押せない', async () => {
    const release = holdRequest('get', TEMPLATE_PATH)
    const { wrapper } = await mountView()
    await flushPromises()

    await byTestid(wrapper, 'order-csv-template').trigger('click')

    expect(byTestid(wrapper, 'order-csv-template').attributes('disabled')).toBeDefined()

    release()
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    await flushPromises()
    expect(byTestid(wrapper, 'order-csv-template').attributes('disabled')).toBeUndefined()
  })

  it('[OCU-15] テンプレートが 500 のとき理由を出し、保存させない', async () => {
    server.use(http.get(TEMPLATE_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 })))
    const { wrapper } = await mountView()
    await flushPromises()

    await byTestid(wrapper, 'order-csv-template').trigger('click')
    await vi.waitFor(() => expect(exists(wrapper, 'order-csv-template-error')).toBe(true))

    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('[OCU-16] テンプレートの CSV を確認するとプレビューへ移り、検証結果が入る', async () => {
    const { wrapper, router, store } = await mountView()
    await flushPromises()

    await dropAndConfirm(wrapper, csvFile(orderCsvTemplateText))
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-csv-preview'))

    expect(store.validation.totalCount).toBe(orderCsvValidateResponse.total_count)
    expect(store.validation.allValid).toBe(true)
  })

  it('[OCU-17] NG 行を含む CSV でもプレビューへ移る', async () => {
    const { wrapper, router, store } = await mountView()
    await flushPromises()

    await dropAndConfirm(wrapper, csvFile(INVALID_CSV))
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-csv-preview'))

    expect(store.validation.hasError).toBe(true)
  })

  it('[OCU-18] ヘッダーが足りない CSV は取込み画面に留まり、理由を出す', async () => {
    const { wrapper, router } = await mountView()
    await flushPromises()

    await dropAndConfirm(wrapper, csvFile(SHORT_HEADER_CSV))
    await vi.waitFor(() => expect(exists(wrapper, 'order-csv-validate-error')).toBe(true))

    expect(byTestid(wrapper, 'order-csv-validate-error').text()).toContain(SHORT_HEADER_DETAIL)
    expect(router.currentRoute.value.name).toBe('order-csv-upload')
  })

  it('[OCU-19] 事前検証の応答を待つ間は「内容を確認する」が押せない', async () => {
    const release = holdRequest('post', VALIDATE_PATH)
    const { wrapper, router } = await mountView()
    await flushPromises()

    await dropAndConfirm(wrapper, csvFile(orderCsvTemplateText))

    expect(byTestid(wrapper, 'order-csv-confirm').attributes('disabled')).toBeDefined()

    release()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-csv-preview'))
  })

  it('[OCU-20] 前回のテンプレートと検証のエラーはマウントし直すと出ない', async () => {
    server.use(http.get(TEMPLATE_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 })))
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useOrderCsvStore(pinia)
    await store.downloadTemplate()
    await store.validateFile(csvFile(SHORT_HEADER_CSV))
    // 前提: 両方のエラーがストアに残っている
    expect(store.templateError).not.toBeNull()
    expect(store.validationError).not.toBeNull()

    const { wrapper } = await mountView({ pinia })
    await flushPromises()

    expect(exists(wrapper, 'order-csv-template-error')).toBe(false)
    expect(exists(wrapper, 'order-csv-validate-error')).toBe(false)
  })
})

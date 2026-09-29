import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderCsvColumns } from '@/mocks/fixtures/orderCsv'
import OrderCsvUploadView from './OrderCsvUploadView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 「CSVフォーマット」表の 4 状態と取込み口の活性を検証する。
 */
const SPEC_PATH = '*/api/orders/csv-spec'
const DETAIL = 'サーバーでエラーが発生しました。'

// 期待値はフィクスチャから導く（22 列・列名・必須の内訳を直接書かない）
const byIndex = [...orderCsvColumns].sort((a, b) => a.index - b.index)
const conditioned = byIndex.filter((column) => column.condition)
const optional = byIndex.filter((column) => column.required !== true)

const Page = { render: () => h('div') }

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/orders/csv/upload', name: 'order-csv-upload', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ name: 'order-csv-upload' })

  const wrapper = mount(OrderCsvUploadView, {
    global: {
      plugins: [createPinia(), router],
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
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
})

import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { sliceCriteriaSetting } from '@/mocks/fixtures/sliceCriteria'
import { formatQuantity } from '@/utils/format'
import SliceCriteriaMasterView from './SliceCriteriaMasterView.vue'

/*
 * 画面テスト。実 Pinia + テスト用 router + MSW(node) を通し、
 * 4状態の出し分けと「比率 ↔ %」の変換・入力欄の初期化を検証する。
 */
const PATH = '/masters/hard-limits'

// 期待値はフィクスチャから導く（0.05 / 10000 / 1000000 を直接書かない）
const RATE = sliceCriteriaSetting['市場関与率']
const QUANTITY = sliceCriteriaSetting['大口数量閾値']
const AMOUNT = sliceCriteriaSetting['大口金額閾値']

// 画面が見せる % 表記（画面と同じ丸め規則で導く）
const toPercent = (ratio) => Math.round(ratio * 10000) / 100
const PERCENT = toPercent(RATE)

// 保存に使う「現在値とは違う、有効な範囲の %」もフィクスチャから導く
const NEW_PERCENT = PERCENT / 2
// モックが 422 で拒む値（市場関与率の下限は 0.0001 = 0.01%）
const INVALID_PERCENT = 0

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const SAVED_MESSAGE = 'スライス基準を保存しました。'
const EMPTY_MESSAGE = 'スライス基準が設定されていません。'
const READONLY_MESSAGE = '更新は管理責任者だけが実行できます。'
/*
 * 実 API（FastAPI）の 422 は項目名を含まない msg を返し、client.js が loc から項目名を補う。
 * 文言そのものはサーバ側の資産なので、ここでは「どの項目が・なぜ駄目か」が出ることだけを見る。
 */
const INVALID_RATE_MESSAGE = '市場関与率: 指定できる下限を下回っています'

// 実 API のエラー本文は ErrorResponse（{ detail: string }）
const errorHandler = (options) =>
  http.get(
    '*/api/masters/hard-limits',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
// 本文なし（204）。実 API では起きないが、画面の 4 状態を保つための空応答
const emptyHandler = () =>
  http.get('*/api/masters/hard-limits', () => new HttpResponse(null, { status: 204 }))

const Page = { render: () => h('div') }

async function mountView({ query } = {}) {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  // 編集可否は URL クエリ（?as_user）から決まるので、クエリ付きでも開けるようにする
  await router.push({ path: PATH, query })

  const wrapper = mount(SliceCriteriaMasterView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込むボタンを wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 取得 → 反映 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const text = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).text()
const inputValue = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).element.value
const setRate = async (wrapper, value) => {
  await wrapper.find('[data-testid="slice-criteria-rate-input"]').setValue(String(value))
}
const submit = async (wrapper) => {
  await wrapper.find('[data-testid="slice-criteria-form"]').trigger('submit')
}

// シナリオ: docs/unit/views-slice-criteria-master-view.md
describe('SliceCriteriaMasterView', () => {
  it('[SCV-01] 取得中はローディングを表示する', async () => {
    // store.load() は setup 中に始まるので、最初の描画が既にローディング状態
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'slice-criteria-loading')).toBe(true)
    expect(exists(wrapper, 'slice-criteria-current')).toBe(false)
    expect(exists(wrapper, 'slice-criteria-form')).toBe(false)
  })

  it('[SCV-02] 取得が失敗したときはメッセージと再試行ボタンを表示する', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="slice-criteria-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'slice-criteria-form')).toBe(false)
  })

  it('[SCV-03] 未設定のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(text(wrapper, 'slice-criteria-empty')).toBe(EMPTY_MESSAGE)
    expect(exists(wrapper, 'slice-criteria-current')).toBe(false)
    expect(exists(wrapper, 'slice-criteria-form')).toBe(false)
  })

  it('[SCV-04] 取得成功時は現在値を表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(text(wrapper, 'slice-criteria-rate')).toBe(`${PERCENT.toFixed(2)}%`)
    expect(text(wrapper, 'slice-criteria-quantity')).toBe(`${formatQuantity(QUANTITY)} 株`)
    expect(text(wrapper, 'slice-criteria-amount')).toBe(`USD ${formatQuantity(AMOUNT)}`)
  })

  it('[SCV-05] 入力欄が現在値で初期化される', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 市場関与率だけは比率ではなく % で入る
    expect(inputValue(wrapper, 'slice-criteria-rate-input')).toBe(String(PERCENT))
    expect(inputValue(wrapper, 'slice-criteria-quantity-input')).toBe(String(QUANTITY))
    expect(inputValue(wrapper, 'slice-criteria-amount-input')).toBe(String(AMOUNT))
  })

  it('[SCV-06] 保存が成功すると成功メッセージが出て現在値が更新される', async () => {
    const { wrapper } = await mountView()
    await settle()

    await setRate(wrapper, NEW_PERCENT)
    await submit(wrapper)
    // PUT → 現在値の差し替え → 再描画 の分だけ待つ
    await settle()

    expect(text(wrapper, 'slice-criteria-notice')).toBe(SAVED_MESSAGE)
    expect(exists(wrapper, 'slice-criteria-save-error')).toBe(false)
    expect(text(wrapper, 'slice-criteria-rate')).toBe(`${NEW_PERCENT.toFixed(2)}%`)
  })

  it('[SCV-07] 範囲外の市場関与率で保存すると理由が出て現在値は変わらない', async () => {
    const { wrapper } = await mountView()
    await settle()

    await setRate(wrapper, INVALID_PERCENT)
    await submit(wrapper)
    await settle()

    expect(text(wrapper, 'slice-criteria-save-error')).toContain(INVALID_RATE_MESSAGE)
    expect(exists(wrapper, 'slice-criteria-notice')).toBe(false)
    expect(text(wrapper, 'slice-criteria-rate')).toBe(`${PERCENT.toFixed(2)}%`)
  })

  it('[SCV-08] 「再試行」で取り直すとエラーが消えて現在値が出る', async () => {
    // 2回目は既定ハンドラ（フィクスチャ）に戻る
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'slice-criteria-error')).toBe(true)

    await wrapper.find('[data-testid="slice-criteria-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'slice-criteria-error')).toBe(false)
    expect(text(wrapper, 'slice-criteria-rate')).toBe(`${PERCENT.toFixed(2)}%`)
  })

  it('[SCV-09] 既定では管理責任者として設定変更フォームを表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(text(wrapper, 'slice-criteria-role')).toBe('管理責任者')
    expect(exists(wrapper, 'slice-criteria-form')).toBe(true)
    expect(exists(wrapper, 'slice-criteria-readonly')).toBe(false)
  })

  it('[SCV-10] 閲覧のみで開くとフォームの代わりに更新できない旨を表示する', async () => {
    const { wrapper } = await mountView({ query: { as_user: 'viewer' } })
    await settle()

    expect(text(wrapper, 'slice-criteria-role')).toBe('閲覧のみ')
    expect(text(wrapper, 'slice-criteria-readonly')).toBe(READONLY_MESSAGE)
    expect(exists(wrapper, 'slice-criteria-form')).toBe(false)
    // 現在値は閲覧のみでも読める
    expect(text(wrapper, 'slice-criteria-rate')).toBe(`${PERCENT.toFixed(2)}%`)
  })
})

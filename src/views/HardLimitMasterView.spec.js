import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { hardLimitSetting } from '@/mocks/fixtures/hardLimits'
import { formatQuantity } from '@/utils/format'
import HardLimitMasterView from './HardLimitMasterView.vue'

/*
 * 画面テスト。実 Pinia + テスト用 router + MSW(node) を通し、
 * 4状態の出し分けと「比率 ↔ %」の変換・入力欄の初期化を検証する。
 */
const PATH = '/masters/hard-limits'

// 期待値はフィクスチャから導く（0.05 / 10000 / 1000000 を直接書かない）
const RATE = hardLimitSetting['市場関与率']
const QUANTITY = hardLimitSetting['大口数量閾値']
const AMOUNT = hardLimitSetting['大口金額閾値']

// 画面が見せる % 表記（画面と同じ丸め規則で導く）
const toPercent = (ratio) => Math.round(ratio * 10000) / 100
const PERCENT = toPercent(RATE)

// 保存に使う「現在値とは違う、有効な範囲の %」もフィクスチャから導く
const NEW_PERCENT = PERCENT / 2
// モックが 400 で拒む値（市場関与率の下限は 0.0001 = 0.01%）
const INVALID_PERCENT = 0

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const SAVED_MESSAGE = 'ハードリミットを保存しました。'
const EMPTY_MESSAGE = 'ハードリミットが設定されていません。'
const INVALID_RATE_MESSAGE = '市場関与率は 0.01%〜100%（0.0001〜1.0）の範囲で入力してください。'

const errorHandler = (options) =>
  http.get(
    '*/api/slice-settings',
    () => HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
// 本文なし（204）。未設定を表す応答
const emptyHandler = () =>
  http.get('*/api/slice-settings', () => new HttpResponse(null, { status: 204 }))

const Page = { render: () => h('div') }

async function mountView() {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(PATH)

  const wrapper = mount(HardLimitMasterView, {
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
  await wrapper.find('[data-testid="hard-limits-rate-input"]').setValue(String(value))
}
const submit = async (wrapper) => {
  await wrapper.find('[data-testid="hard-limits-form"]').trigger('submit')
}

// シナリオ: docs/unit/views-hard-limit-master-view.md
describe('HardLimitMasterView', () => {
  it('[HLV-01] 取得中はローディングを表示する', async () => {
    // store.load() は setup 中に始まるので、最初の描画が既にローディング状態
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'hard-limits-loading')).toBe(true)
    expect(exists(wrapper, 'hard-limits-current')).toBe(false)
    expect(exists(wrapper, 'hard-limits-form')).toBe(false)
  })

  it('[HLV-02] 取得が失敗したときはメッセージと再試行ボタンを表示する', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="hard-limits-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'hard-limits-form')).toBe(false)
  })

  it('[HLV-03] 未設定のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(text(wrapper, 'hard-limits-empty')).toBe(EMPTY_MESSAGE)
    expect(exists(wrapper, 'hard-limits-current')).toBe(false)
    expect(exists(wrapper, 'hard-limits-form')).toBe(false)
  })

  it('[HLV-04] 取得成功時はモック注記と現在値を表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'hard-limits-mock-notice')).toBe(true)
    expect(text(wrapper, 'hard-limits-rate')).toBe(`${PERCENT.toFixed(2)}%`)
    expect(text(wrapper, 'hard-limits-quantity')).toBe(`${formatQuantity(QUANTITY)} 株`)
    expect(text(wrapper, 'hard-limits-amount')).toBe(`USD ${formatQuantity(AMOUNT)}`)
  })

  it('[HLV-05] 入力欄が現在値で初期化される', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 市場関与率だけは比率ではなく % で入る
    expect(inputValue(wrapper, 'hard-limits-rate-input')).toBe(String(PERCENT))
    expect(inputValue(wrapper, 'hard-limits-quantity-input')).toBe(String(QUANTITY))
    expect(inputValue(wrapper, 'hard-limits-amount-input')).toBe(String(AMOUNT))
  })

  it('[HLV-06] 保存が成功すると成功メッセージが出て現在値が更新される', async () => {
    const { wrapper } = await mountView()
    await settle()

    await setRate(wrapper, NEW_PERCENT)
    await submit(wrapper)
    // PUT → 現在値の差し替え → 再描画 の分だけ待つ
    await settle()

    expect(text(wrapper, 'hard-limits-notice')).toBe(SAVED_MESSAGE)
    expect(exists(wrapper, 'hard-limits-save-error')).toBe(false)
    expect(text(wrapper, 'hard-limits-rate')).toBe(`${NEW_PERCENT.toFixed(2)}%`)
  })

  it('[HLV-07] 範囲外の市場関与率で保存すると理由が出て現在値は変わらない', async () => {
    const { wrapper } = await mountView()
    await settle()

    await setRate(wrapper, INVALID_PERCENT)
    await submit(wrapper)
    await settle()

    expect(text(wrapper, 'hard-limits-save-error')).toContain(INVALID_RATE_MESSAGE)
    expect(exists(wrapper, 'hard-limits-notice')).toBe(false)
    expect(text(wrapper, 'hard-limits-rate')).toBe(`${PERCENT.toFixed(2)}%`)
  })

  it('[HLV-08] 「再試行」で取り直すとエラーが消えて現在値が出る', async () => {
    // 2回目は既定ハンドラ（フィクスチャ）に戻る
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'hard-limits-error')).toBe(true)

    await wrapper.find('[data-testid="hard-limits-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'hard-limits-error')).toBe(false)
    expect(text(wrapper, 'hard-limits-rate')).toBe(`${PERCENT.toFixed(2)}%`)
  })
})

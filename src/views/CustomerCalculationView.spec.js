import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import CustomerCalculationView from './CustomerCalculationView.vue'

/*
 * 画面テスト（顧客詳細の仮計算タブ）。いまは見た目だけの画面なので、API は読まない。
 * URL クエリの引き継ぎが入力欄の初期値になることと、売買・預り区分で結果のカードが切り替わることを見る。
 * 枠（CustomerDetailView）は通さず、この画面だけをマウントする。
 */
const Page = { render: () => h('div') }

/** 国内約定日の既定（今日）を固定する日 */
const TODAY = new Date(2026, 9, 6, 9, 0, 0)

const BASE_ROWS = [
  '外貨約定代金',
  '現地費用合計',
  '取引所税',
  '円換算約定金額',
  '円換算現地費用',
  '円換算スプレッド',
  '国内手数料',
  '消費税',
]

async function mountView(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/:customerId(\\d+)/summary', name: 'customer-summary', component: Page },
      {
        path: '/customers/:customerId(\\d+)/calculations',
        name: 'customer-calculations',
        component: CustomerCalculationView,
      },
    ],
  })
  await router.push({ path: '/customers/1/calculations', query })

  const wrapper = mount(CustomerCalculationView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const valueOf = (wrapper, testid) => find(wrapper, testid).element.value
const selectedSide = (wrapper) => find(wrapper, 'customer-calc-side').find('[aria-pressed="true"]')
const selectedLabel = (wrapper, testid) =>
  find(wrapper, testid).element.selectedOptions[0].textContent.trim()
const resultRows = (wrapper) =>
  find(wrapper, 'customer-calc-result-rows')
    .findAll('dt')
    .map((dt) => dt.text())

async function chooseSide(wrapper, label) {
  const button = find(wrapper, 'customer-calc-side')
    .findAll('button')
    .find((item) => item.text() === label)
  await button.trigger('click')
}

// シナリオ: docs/unit/views-customer-calculation-view.md
describe('CustomerCalculationView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[CCV-01] クエリなしなら既定の入力値で 3 区画が出る', async () => {
    const { wrapper } = await mountView()

    expect(valueOf(wrapper, 'customer-calc-symbol')).toBe('')
    expect(selectedSide(wrapper).text()).toBe('買い')
    expect(selectedLabel(wrapper, 'customer-calc-deposit')).toBe('特定')
    expect(valueOf(wrapper, 'customer-calc-trade-date')).toBe('20261006')
    expect(selectedLabel(wrapper, 'customer-calc-local-fee-category')).toBe('通常')
    expect(selectedLabel(wrapper, 'customer-calc-fee-pattern')).toBe('顧客属性を適用')
    expect(find(wrapper, 'customer-calc-tax-exempt').element.checked).toBe(false)
    expect(wrapper.findAll('h2').map((title) => title.text())).toEqual([
      '現地費用外貨建て',
      '手数料条件未入力時は顧客属性の設定を補完',
    ])
  })

  it('[CCV-02] 結果のカードは買付概算の枠だけで、金額は「—」', async () => {
    const { wrapper } = await mountView()

    expect(find(wrapper, 'customer-calc-result-caption').text()).toBe('買付概算 ／ 未実行')
    expect(find(wrapper, 'customer-calc-total-label').text()).toBe('概算必要金額')
    expect(find(wrapper, 'customer-calc-total').text()).toBe('—')
    expect(resultRows(wrapper)).toEqual(BASE_ROWS)
    expect(find(wrapper, 'customer-calc-profit-loss').exists()).toBe(false)
  })

  it('[CCV-03] 引き継いだ銘柄・売り・預り区分が入り、結果は売却概算になる', async () => {
    const { wrapper } = await mountView({ symbol: 'nvda', side: 'sell', specific_deposit: '6' })

    expect(valueOf(wrapper, 'customer-calc-symbol')).toBe('NVDA')
    expect(selectedSide(wrapper).text()).toBe('売り')
    expect(selectedLabel(wrapper, 'customer-calc-deposit')).toBe('成長投資枠')
    expect(find(wrapper, 'customer-calc-result-caption').text()).toBe('売却概算 ／ 未実行')
    expect(find(wrapper, 'customer-calc-total-label').text()).toBe('概算受取金額')
    expect(find(wrapper, 'customer-calc-profit-loss').text()).toContain('—')
  })

  it('[CCV-04] 読めないクエリは既定のまま', async () => {
    const { wrapper } = await mountView({ side: 'hold', specific_deposit: '4' })

    expect(selectedSide(wrapper).text()).toBe('買い')
    expect(selectedLabel(wrapper, 'customer-calc-deposit')).toBe('特定')
  })

  it('[CCV-05] 成長投資枠の買いだけ NISA の 2 行が足される', async () => {
    const { wrapper } = await mountView()

    await find(wrapper, 'customer-calc-deposit').setValue('6')
    expect(resultRows(wrapper)).toEqual([
      ...BASE_ROWS.slice(0, 6),
      'NISA仮計算適用為替',
      'NISA仮計算用為替上乗せ',
      ...BASE_ROWS.slice(6),
    ])

    await chooseSide(wrapper, '売り')
    expect(resultRows(wrapper)).toEqual(BASE_ROWS)
  })

  it('[CCV-06] 「仮計算を実行」はまだ何もせず、「戻る」は外株預りを指す', async () => {
    const { wrapper, router } = await mountView()

    await find(wrapper, 'customer-calc-form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('customer-calculations')
    expect(find(wrapper, 'customer-calc-total').text()).toBe('—')
    expect(find(wrapper, 'customer-calc-back').attributes('href')).toBe('/customers/1/summary')
  })
})

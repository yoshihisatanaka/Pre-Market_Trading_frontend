import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { http } from 'msw'
import { server } from '@/mocks/server'
import { buildCalculationResponse, calculationMessages } from '@/mocks/fixtures/calculations'
import { customers } from '@/mocks/fixtures/customers'
import { currentCalculationSetting } from '@/mocks/handlers/calculationSettings'
import { useCodesStore } from '@/stores/codes'
import { SPECIFIC_DEPOSIT } from '@/utils/apiEnums'
import { formatJpyUnit, formatQuantity, formatUsdUnit } from '@/utils/format'
import { SIDE } from '@/utils/orderEntryOptions'
import { formatSignedJpyUnit, profitLossTone } from '@/utils/profitLoss'
import CustomerCalculationView from './CustomerCalculationView.vue'
import CustomerDetailView from './CustomerDetailView.vue'

/*
 * 画面テスト（顧客詳細の仮計算タブ）。枠（CustomerDetailView）ごと /customers/:id/calculations から
 * マウントし、実際の Pinia ストア + vue-router + MSW(node) を通す。
 * URL クエリの引き継ぎ・入力の検証・結果のカードの 4 状態（未実行 / 計算中 / 失敗 / 結果あり）・送る本文を見る。
 * 結果の期待値は既定モックの計算（fixtures/calculations.js）に同じ本文を渡して導く。
 */
const CALCULATIONS = '*/api/calculations'
const PATH = '/customers/1/calculations'

const CUSTOMER = customers.find((row) => row.ID === 1)

/** 国内約定日の既定（今日）を固定する日 */
const TODAY = new Date(2026, 9, 6, 9, 0, 0)

const BASE_ROWS = [
  '外貨約定代金',
  '現地費用合計',
  '取引所税',
  '適用為替',
  '円換算精算金額',
  '国内手数料',
  '消費税',
]
const NISA_ROWS = ['NISA仮計算適用為替', 'NISA使用予定額']
/** NISA の 2 行は円換算精算金額の後ろ（国内手数料の前）に入る */
const WITH_NISA_ROWS = [...BASE_ROWS.slice(0, 5), ...NISA_ROWS, ...BASE_ROWS.slice(5)]

const fxRateFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})
const formatFx = (value) => `${fxRateFormat.format(value)} 円/USD`

const Page = { render: () => h('div') }
const Root = { render: () => h(RouterView) }

async function mountView(query = {}) {
  // 実 router/index.js は createWebHistory 固定なので、テスト用に同じ形の最小定義を作る
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/search', name: 'customer-search', component: Page },
      {
        path: '/customers/:customerId(\\d+)',
        component: CustomerDetailView,
        children: [
          { path: 'summary', name: 'customer-summary', component: Page },
          { path: 'orders', name: 'customer-orders', component: Page },
          { path: 'order-entry', name: 'customer-order-entry', component: Page },
          { path: 'calculations', name: 'customer-calculations', component: CustomerCalculationView },
        ],
      },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  // App.vue はコードマスタを読み終えてから画面を描く。それに合わせて先に読んでおく
  const pinia = createPinia()
  await useCodesStore(pinia).load()

  const wrapper = mount(Root, {
    global: {
      plugins: [pinia, router],
      stubs: { teleport: true },
    },
  })
  await settle()
  return { wrapper, router }
}

/** 顧客の読み込み → 画面の描画、または送信 → 応答の反映までを待つ */
async function settle() {
  for (let i = 0; i < 4; i += 1) await flushPromises()
}

/** 仮計算の応答を握る。解放すると既定のハンドラに流れる */
function gateCalculation() {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.post(CALCULATIONS, async () => {
      await wait
      return undefined
    }),
  )
  return release
}

/** 仮計算の POST に届いた本文を記録する（応答は既定のハンドラに任せる） */
function recordBodies() {
  const bodies = []
  server.use(
    http.post(CALCULATIONS, async ({ request }) => {
      bodies.push(await request.clone().json())
      return undefined
    }),
  )
  return bodies
}

/** 既定モックが同じ本文に返す応答（期待値の導出元） */
function expectedResponse({ symbol, side, quantity, unitPrice, specificDeposit, feePattern }) {
  return buildCalculationResponse(
    {
      口座番号: CUSTOMER.口座番号,
      銘柄コード: symbol,
      売買区分: side,
      数量: quantity,
      単価: unitPrice,
      特定預り区分: specificDeposit,
      手数料パターン: feePattern ?? null,
      消費税不要区分: false,
    },
    { setting: currentCalculationSetting() },
  )
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const textOf = (wrapper, testid) => find(wrapper, testid).text()
const valueOf = (wrapper, testid) => find(wrapper, testid).element.value
const selectedSide = (wrapper) => find(wrapper, 'customer-calc-side').find('[aria-pressed="true"]')
const selectedLabel = (wrapper, testid) =>
  find(wrapper, testid).element.selectedOptions[0].textContent.trim()
const resultRows = (wrapper) =>
  find(wrapper, 'customer-calc-result-rows')
    .findAll('dt')
    .map((dt) => dt.text())
const rowValue = (wrapper, key) => textOf(wrapper, `customer-calc-row-${key}`)
/** 入力欄に aria-describedby で結び付いたエラー（role="alert"）の文言。なければ '' */
const fieldError = (wrapper, testid) => {
  const ids = (find(wrapper, testid).attributes('aria-describedby') ?? '').split(' ')
  const alert = ids
    .map((id) => id && wrapper.element.querySelector(`[id="${id}"]`))
    .find((element) => element?.getAttribute('role') === 'alert')
  return alert?.textContent.trim() ?? ''
}

async function chooseSide(wrapper, label) {
  const button = find(wrapper, 'customer-calc-side')
    .findAll('button')
    .find((item) => item.text() === label)
  await button.trigger('click')
}

/** 入力して「仮計算を実行」を押す。応答の反映までは待たない */
async function fillAndSubmit(
  wrapper,
  { symbol, side, specificDeposit, quantity, unitPrice, feePattern },
) {
  if (symbol !== undefined) await find(wrapper, 'customer-calc-symbol').setValue(symbol)
  if (side === SIDE.SELL) await chooseSide(wrapper, '売り')
  if (specificDeposit !== undefined) {
    await find(wrapper, 'customer-calc-deposit').setValue(specificDeposit)
  }
  if (quantity !== undefined) {
    await find(wrapper, 'customer-calc-quantity').setValue(String(quantity))
  }
  if (unitPrice !== undefined) {
    await find(wrapper, 'customer-calc-unit-price').setValue(String(unitPrice))
  }
  if (feePattern !== undefined) await find(wrapper, 'customer-calc-fee-pattern').setValue(feePattern)
  await find(wrapper, 'customer-calc-form').trigger('submit')
}

const SELL_SPECIFIC = {
  symbol: 'AAPL',
  side: SIDE.SELL,
  specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
  quantity: 10,
  unitPrice: 230.5,
}
const BUY_GROWTH = {
  symbol: 'NVDA',
  side: SIDE.BUY,
  specificDeposit: SPECIFIC_DEPOSIT.GROWTH_QUOTA,
  quantity: 10,
  unitPrice: 230.5,
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
    expect(
      find(wrapper, 'customer-calc-form')
        .findAll('h2')
        .map((title) => title.text()),
    ).toEqual(['現地費用外貨建て', '手数料条件未入力時は顧客属性の設定を補完'])
  })

  it('[CCV-02] 未実行の結果のカードは買付概算の 7 行で、金額は「—」', async () => {
    const { wrapper } = await mountView()

    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe('買付概算 ／ 未実行')
    expect(textOf(wrapper, 'customer-calc-total-label')).toBe('概算必要金額')
    expect(textOf(wrapper, 'customer-calc-total')).toBe('—')
    expect(resultRows(wrapper)).toEqual(BASE_ROWS)
    expect(exists(wrapper, 'customer-calc-profit-loss')).toBe(false)
  })

  it('[CCV-03] 引き継いだ銘柄・売り・成長投資枠が入り、概算損益は出ない', async () => {
    const { wrapper } = await mountView({ symbol: 'nvda', side: 'sell', specific_deposit: '6' })

    expect(valueOf(wrapper, 'customer-calc-symbol')).toBe('NVDA')
    expect(selectedSide(wrapper).text()).toBe('売り')
    expect(selectedLabel(wrapper, 'customer-calc-deposit')).toBe('成長投資枠')
    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe('売却概算 ／ 未実行')
    expect(textOf(wrapper, 'customer-calc-total-label')).toBe('概算受取金額')
    expect(resultRows(wrapper)).toEqual(BASE_ROWS)
    expect(exists(wrapper, 'customer-calc-profit-loss')).toBe(false)
  })

  it('[CCV-04] 読めないクエリは既定のまま', async () => {
    const { wrapper } = await mountView({ side: 'hold', specific_deposit: '4' })

    expect(selectedSide(wrapper).text()).toBe('買い')
    expect(selectedLabel(wrapper, 'customer-calc-deposit')).toBe('特定')
  })

  it('[CCV-05] 成長投資枠の買いだけ NISA の 2 行が円換算精算金額の後ろに入る', async () => {
    const { wrapper } = await mountView()

    await find(wrapper, 'customer-calc-deposit').setValue(SPECIFIC_DEPOSIT.GROWTH_QUOTA)
    expect(resultRows(wrapper)).toEqual(WITH_NISA_ROWS)

    await chooseSide(wrapper, '売り')
    expect(resultRows(wrapper)).toEqual(BASE_ROWS)
  })

  it('[CCV-06] 「戻る」は外株預りを指す', async () => {
    const { wrapper } = await mountView()

    expect(find(wrapper, 'customer-calc-back').attributes('href')).toBe(
      `/customers/${CUSTOMER.ID}/summary`,
    )
  })

  it('[CCV-07] 数量・単価が空なら項目の直下に不備が出て、API は呼ばない', async () => {
    const bodies = recordBodies()
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, { symbol: 'AAPL' })
    await settle()

    expect(fieldError(wrapper, 'customer-calc-quantity')).toBe(
      '数量は9桁以内の1株以上で入力してください。',
    )
    expect(fieldError(wrapper, 'customer-calc-unit-price')).toBe('単価を入力してください。')
    expect(fieldError(wrapper, 'customer-calc-symbol')).toBe('')
    expect(bodies).toHaveLength(0)
    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe('買付概算 ／ 未実行')
  })

  it('[CCV-08] 特定の売りは応答の金額と概算損益が出る', async () => {
    const response = expectedResponse(SELL_SPECIFIC)
    const { 外貨: foreign, 円貨: yen } = response
    expect(yen.概算譲渡損益).not.toBeNull()
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, SELL_SPECIFIC)
    await settle()

    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe(
      `売却概算 ／ ${response.Ticker} ${formatQuantity(SELL_SPECIFIC.quantity)}株`,
    )
    expect(resultRows(wrapper)).toEqual([
      '外貨約定代金',
      '現地費用合計（手数料は自動）',
      '取引所税（自動）',
      '適用為替（為替 ± スプレッド）',
      '円換算精算金額',
      '国内手数料',
      '消費税',
    ])
    expect(rowValue(wrapper, 'grossAmount')).toBe(formatUsdUnit(foreign.現地約定金額))
    expect(rowValue(wrapper, 'localCost')).toBe(
      formatUsdUnit(foreign.現地手数料 + foreign.現地取引税 + foreign.現地諸経費),
    )
    expect(rowValue(wrapper, 'exchangeTax')).toBe(formatUsdUnit(foreign.現地取引税))
    expect(rowValue(wrapper, 'tradeFxRate')).toBe(formatFx(yen.約定為替レート))
    expect(rowValue(wrapper, 'settlementJpy')).toBe(formatJpyUnit(yen.現地精算金額))
    expect(rowValue(wrapper, 'domesticFee')).toBe(formatJpyUnit(yen.国内手数料))
    expect(rowValue(wrapper, 'consumptionTax')).toBe(formatJpyUnit(yen.消費税))
    expect(textOf(wrapper, 'customer-calc-total-label')).toBe('概算受取金額')
    expect(textOf(wrapper, 'customer-calc-total')).toBe(formatJpyUnit(yen.最終精算金額))

    const profitLoss = find(wrapper, 'customer-calc-profit-loss-value')
    expect(profitLoss.text()).toBe(formatSignedJpyUnit(yen.概算譲渡損益))
    expect(profitLoss.classes()).toContain(`is-${profitLossTone(yen.概算譲渡損益)}`)
    expect(exists(wrapper, 'customer-calc-error')).toBe(false)
  })

  it('[CCV-09] 成長投資枠の買いは NISA の 2 行に応答の値が出る', async () => {
    const response = expectedResponse(BUY_GROWTH)
    const { 外貨: foreign, 円貨: yen } = response
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, BUY_GROWTH)
    await settle()

    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe(
      `買付概算 ／ ${response.Ticker} ${formatQuantity(BUY_GROWTH.quantity)}株`,
    )
    expect(resultRows(wrapper)).toHaveLength(WITH_NISA_ROWS.length)
    expect(resultRows(wrapper).slice(5, 7)).toEqual(NISA_ROWS)
    expect(rowValue(wrapper, 'nisaFxRate')).toBe(formatFx(foreign.NISA計算用為替レート))
    expect(rowValue(wrapper, 'nisaAmount')).toBe(formatJpyUnit(foreign.NISA使用予定額))
    expect(textOf(wrapper, 'customer-calc-total-label')).toBe('概算必要金額')
    expect(textOf(wrapper, 'customer-calc-total')).toBe(formatJpyUnit(yen.最終精算金額))
    expect(exists(wrapper, 'customer-calc-profit-loss')).toBe(false)
  })

  it('[CCV-10] 銘柄が無ければ 400 の理由がエラーの帯に出て、金額は「—」', async () => {
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, { ...BUY_GROWTH, symbol: 'ZZZZ' })
    await settle()

    expect(textOf(wrapper, 'customer-calc-error')).toBe(calculationMessages.symbolNotFound('ZZZZ'))
    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe(
      '買付概算 ／ 計算できませんでした',
    )
    expect(textOf(wrapper, 'customer-calc-total')).toBe('—')
    expect(exists(wrapper, 'customer-calc-warnings')).toBe(false)
  })

  it('[CCV-11] サーバの warnings は注意の帯に 1 件ずつ並ぶ', async () => {
    const input = {
      symbol: 'MSFT',
      side: SIDE.SELL,
      specificDeposit: SPECIFIC_DEPOSIT.NON_SPECIFIC,
      quantity: 10,
      unitPrice: 230.5,
      feePattern: 'Z',
    }
    const { warnings } = expectedResponse(input)
    expect(warnings).toEqual([
      calculationMessages.unknownPattern('Z'),
      calculationMessages.noHolding,
    ])
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, input)
    await settle()

    expect(
      find(wrapper, 'customer-calc-warnings')
        .findAll('li')
        .map((li) => li.text()),
    ).toEqual(warnings)
    expect(exists(wrapper, 'customer-calc-error')).toBe(false)
  })

  it('[CCV-12] 応答までは「計算中…」でボタンは押せず、届くと結果になる', async () => {
    const release = gateCalculation()
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, SELL_SPECIFIC)
    await settle()

    const submit = find(wrapper, 'customer-calc-submit')
    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe('売却概算 ／ 計算中…')
    expect(submit.attributes('disabled')).toBeDefined()
    expect(submit.attributes('aria-busy')).toBe('true')
    expect(find(wrapper, 'customer-calc-result').attributes('aria-busy')).toBe('true')

    release()
    await settle()

    const response = expectedResponse(SELL_SPECIFIC)
    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe(
      `売却概算 ／ ${response.Ticker} ${formatQuantity(SELL_SPECIFIC.quantity)}株`,
    )
    expect(find(wrapper, 'customer-calc-submit').attributes('disabled')).toBeUndefined()
    expect(find(wrapper, 'customer-calc-result').attributes('aria-busy')).toBeUndefined()
  })

  it('[CCV-13] 口座番号は integer、空欄の任意項目は null で送り、国内約定日と現地手数料区分は送らない', async () => {
    const bodies = recordBodies()
    const { wrapper } = await mountView()

    await fillAndSubmit(wrapper, { symbol: 'aapl', quantity: 10, unitPrice: 230.5 })
    await settle()

    expect(bodies).toHaveLength(1)
    const [body] = bodies
    expect(body).toMatchObject({
      口座番号: CUSTOMER.口座番号,
      銘柄コード: 'AAPL',
      売買区分: SIDE.BUY,
      数量: 10,
      単価: 230.5,
      特定預り区分: SPECIFIC_DEPOSIT.SPECIFIC,
      為替レート: null,
      現地手数料1: null,
      現地手数料2: null,
      その他諸経費1: null,
      その他諸経費2: null,
      現地取引税1: null,
      現地取引税2: null,
      現地取引税3: null,
      手数料パターン: null,
      掛目: null,
      BP: null,
      消費税不要区分: false,
      手数料下限: null,
      手数料上限: null,
    })
    expect(Number.isInteger(body.口座番号)).toBe(true)
    expect(Object.keys(body).some((key) => key.includes('約定日'))).toBe(false)
    expect(Object.keys(body).some((key) => key.includes('手数料区分'))).toBe(false)
  })

  it('[CCV-14] タブを開き直すと前回の結果は消える', async () => {
    const { wrapper, router } = await mountView()

    await fillAndSubmit(wrapper, { symbol: 'AAPL', quantity: 10, unitPrice: 230.5 })
    await settle()
    expect(textOf(wrapper, 'customer-calc-total')).not.toBe('—')

    await router.push(`/customers/${CUSTOMER.ID}/summary`)
    await settle()
    await router.push(PATH)
    await settle()

    expect(textOf(wrapper, 'customer-calc-result-caption')).toBe('買付概算 ／ 未実行')
    expect(textOf(wrapper, 'customer-calc-total')).toBe('—')
  })
})

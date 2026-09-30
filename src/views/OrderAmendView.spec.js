import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { formatMonthDayTime, formatQuantity } from '@/utils/format'
import {
  MARKET_SCOPE_OPTIONS,
  marketScopeLabel,
  orderPriceLabel,
  orderStatusLabel,
} from '@/utils/orderTypes'
import OrderAmendView from './OrderAmendView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態・訂正不可の表示・入力検査・変えた項目だけを送ること・完了表示・戻る導線を検証する。
 * 発注権限のガードは router のテスト（PMG）が見るので、ここでは通さない。
 */
const INQUIRY_PATH = '/orders/inquiry'
const DETAIL = '*/api/orders/:orderId'
const AMEND = '*/api/orders/:orderId/amend'

const byId = (id) => orderInquiryRows.find((row) => row.ID === id)
// 状況ごとの対象注文（フィクスチャの ID で引く）
const PENDING = byId(36) // 000 未発注・指値
const WORKING = byId(34) // 003 注文中・成行
const PARTIAL = byId(35) // 010 一部出来・成行
const FILLED = byId(41) // 011 全部出来（訂正できない）
const MAX_ID = Math.max(...orderInquiryRows.map((row) => row.ID))
const MISSING_ID = MAX_ID + 100

const SIDE_LABELS = { 1: '売', 3: '買' }
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const Page = { render: () => h('div') }

/**
 * 訂正画面を開く。from を渡すと、その URL から来た（history.state.back がある）状態にする。
 * createMemoryHistory の state は back を持たないので、getter で差し替えて再現する。
 */
async function mountView(id, { from } = {}) {
  const history = createMemoryHistory()
  if (from) {
    Object.defineProperty(history, 'state', { configurable: true, get: () => ({ back: from }) })
  }
  const router = createRouter({
    history,
    routes: [
      { path: INQUIRY_PATH, name: 'order-inquiry', component: Page },
      { path: '/orders/:orderId(\\d+)/amend', name: 'order-amend', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  if (from) await router.push(from)
  await router.push(`/orders/${id}/amend`)

  const wrapper = mount(OrderAmendView, { global: { plugins: [createPinia(), router] } })
  return { wrapper, router }
}

/** 操作 → 通信 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const quantityInput = (wrapper) => find(wrapper, 'order-amend-quantity')
const limitPriceInput = (wrapper) => find(wrapper, 'order-amend-limit-price')
const orderTypeButton = (wrapper, value) =>
  find(wrapper, 'order-amend-order-type').find(`[data-value="${value}"]`)
const submit = async (wrapper) => {
  await find(wrapper, 'order-amend-form').trigger('submit')
  await settle()
}

/** FormField が入力欄の aria-describedby に渡す id から、エラー文とヒントを引く */
const describedBy = (wrapper, input) =>
  (input.attributes('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => wrapper.find(`#${id}`))
    .filter((el) => el.exists())
const fieldError = (wrapper, input) =>
  describedBy(wrapper, input).find((el) => el.attributes('role') === 'alert')?.text() ?? ''
const fieldHint = (wrapper, input) =>
  describedBy(wrapper, input).find((el) => el.attributes('role') !== 'alert')?.text() ?? ''

const summaryPairs = (wrapper) => {
  const summary = find(wrapper, 'order-amend-summary')
  const values = summary.findAll('dd').map((dd) => dd.text())
  return summary.findAll('dt').map((dt, index) => [dt.text(), values[index]])
}

/** 訂正の POST を記録し、成功の応答を返す。記録は本文の配列 */
function recordAmend(extra = {}) {
  const seen = []
  server.use(
    http.post(AMEND, async ({ request, params }) => {
      seen.push(await request.clone().json())
      return HttpResponse.json({
        success: true,
        mode: 'IN_PLACE',
        original_order_id: Number(params.orderId),
        amendment_order_id: null,
        status: '000',
        message: '訂正しました',
        warnings: [],
        ...extra,
      })
    }),
  )
  return seen
}

/** 指定の method / パスの応答を握る。解放すると既定のハンドラに流れる */
function gate(method, path) {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async () => {
      await wait
      return undefined
    }),
  )
  return release
}

// シナリオ: docs/unit/views-order-amend-view.md
describe('OrderAmendView', () => {
  it('[OAV-01] 取得中はローディングだけが出る', async () => {
    const release = gate('get', DETAIL)
    const { wrapper } = await mountView(PENDING.ID)
    await flushPromises()

    expect(exists(wrapper, 'order-amend-loading')).toBe(true)
    expect(exists(wrapper, 'order-amend-form')).toBe(false)
    expect(exists(wrapper, 'order-amend-error')).toBe(false)
    expect(exists(wrapper, 'order-amend-not-found')).toBe(false)

    release()
    await settle()
  })

  it('[OAV-02] 500 のときはエラーの理由と再試行が出てフォームは出ない', async () => {
    server.use(
      http.get(DETAIL, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    const error = find(wrapper, 'order-amend-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'order-amend-form')).toBe(false)
  })

  it('[OAV-03] 無い注文は not-found と注文照会へ戻る導線を出す', async () => {
    const { wrapper } = await mountView(MISSING_ID)
    await settle()

    const notFound = find(wrapper, 'order-amend-not-found')
    expect(notFound.text()).toContain('注文が見つかりませんでした。')
    expect(notFound.find('button').text()).toBe('注文照会へ戻る')
    expect(exists(wrapper, 'order-amend-error')).toBe(false)
    expect(exists(wrapper, 'order-amend-form')).toBe(false)
  })

  it('[OAV-04] 再試行でフォームが出る', async () => {
    server.use(
      http.get(DETAIL, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    server.resetHandlers()
    await find(wrapper, 'order-amend-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'order-amend-error')).toBe(false)
    expect(exists(wrapper, 'order-amend-form')).toBe(true)
  })

  it('[OAV-05] 訂正対象注文と状況が表示用の文言で出る', async () => {
    const raw = PARTIAL
    const { wrapper } = await mountView(raw.ID)
    await settle()

    expect(find(wrapper, 'order-amend-description').text()).toContain(`注文ID #${raw.ID}`)
    expect(summaryPairs(wrapper)).toEqual([
      ['注文ID', `#${raw.ID}`],
      ['顧客', `部店 ${raw.部店} ／ 口座 ${raw.口座番号}`],
      ['銘柄', raw.Ticker],
      ['売買', SIDE_LABELS[raw.売買区分]],
      [
        '原注文',
        `${formatQuantity(raw.数量)}株 ／ ${orderPriceLabel(raw.指成区分, raw.指値単価)}`,
      ],
      ['市場区分', marketScopeLabel(raw.発注範囲)],
      ['出来数量', `${formatQuantity(raw.出来数量)}株`],
      ['受注日時', formatMonthDayTime(`${raw.受注日}T${raw.受注時刻}`)],
    ])
    expect(find(wrapper, 'order-amend-original').text()).toBe('3,000株 ／ 成行')
    expect(find(wrapper, 'order-amend-status').text()).toBe(orderStatusLabel(raw.処理状況))
    expect(find(wrapper, 'order-amend-status').text()).toBe('一部出来')
  })

  it('[OAV-06] 入力欄は注文の現在値で埋まる', async () => {
    const raw = PENDING
    const { wrapper } = await mountView(raw.ID)
    await settle()

    expect(quantityInput(wrapper).element.value).toBe(String(raw.数量))
    expect(find(wrapper, 'order-amend-market-scope').element.value).toBe(raw.発注範囲)
    expect(orderTypeButton(wrapper, 'LO').attributes('aria-pressed')).toBe('true')
    expect(orderTypeButton(wrapper, 'MO').attributes('aria-pressed')).toBe('false')
    expect(limitPriceInput(wrapper).element.value).toBe(String(raw.指値単価))
    expect(find(wrapper, 'order-amend-reason').element.value).toBe('')
  })

  it('[OAV-07] 出来のある注文だけ数量欄に総数量のヒントが出る', async () => {
    const partial = await mountView(PARTIAL.ID)
    await settle()
    expect(fieldHint(partial.wrapper, quantityInput(partial.wrapper))).toBe(
      `出来数量 ${formatQuantity(PARTIAL.出来数量)}株を含む総数量`,
    )

    const pending = await mountView(PENDING.ID)
    await settle()
    expect(fieldHint(pending.wrapper, quantityInput(pending.wrapper))).toBe('')
  })

  it('[OAV-08] 訂正できない状況は理由を出してフォームを出さない', async () => {
    const { wrapper } = await mountView(FILLED.ID)
    await settle()

    expect(find(wrapper, 'order-amend-locked').text()).toBe(
      `この注文は訂正できません（処理状況: ${orderStatusLabel(FILLED.処理状況)}）。`,
    )
    expect(exists(wrapper, 'order-amend-form')).toBe(false)
    expect(wrapper.findAll('[data-testid="order-amend-back"]')).toHaveLength(1)
    expect(exists(wrapper, 'order-amend-submit')).toBe(false)
  })

  it('[OAV-09] 数量の空・整数でない・0 は項目のエラーになり送らない', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    const cases = [
      ['', '注文数量を入力してください。'],
      ['abc', '注文数量を整数で入力してください。'],
      ['1.5', '注文数量を整数で入力してください。'],
      ['0', '注文数量は1以上で入力してください。'],
    ]
    for (const [value, message] of cases) {
      await quantityInput(wrapper).setValue(value)
      await submit(wrapper)
      expect(fieldError(wrapper, quantityInput(wrapper))).toBe(message)
    }
    expect(seen).toHaveLength(0)
  })

  it('[OAV-10] 数量が出来数量以下ならエラーになり送らない', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PARTIAL.ID)
    await settle()

    await quantityInput(wrapper).setValue(String(PARTIAL.出来数量))
    await submit(wrapper)

    expect(fieldError(wrapper, quantityInput(wrapper))).toBe(
      `注文数量は出来数量（${formatQuantity(PARTIAL.出来数量)}株）より大きい数を入力してください。`,
    )
    expect(seen).toHaveLength(0)
  })

  it('[OAV-11] 指値価格の空・0 以下・数値でない・小数 5 桁は項目のエラーになり送らない', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    const cases = [
      ['', '指値価格を入力してください。'],
      ['0', '指値価格は0より大きい数値を入力してください。'],
      ['abc', '指値価格は0より大きい数値を入力してください。'],
      ['1.23456', '指値には、「小数点第４位以内」で入力してください。'],
    ]
    for (const [value, message] of cases) {
      await limitPriceInput(wrapper).setValue(value)
      await submit(wrapper)
      expect(fieldError(wrapper, limitPriceInput(wrapper))).toBe(message)
    }
    expect(seen).toHaveLength(0)
  })

  it('[OAV-12] 何も変えていない（理由だけ）なら「変更された項目がありません。」で送らない', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await submit(wrapper)
    expect(find(wrapper, 'order-amend-form-error').text()).toBe('変更された項目がありません。')

    await find(wrapper, 'order-amend-reason').setValue('お客様申出')
    await submit(wrapper)
    expect(find(wrapper, 'order-amend-form-error').text()).toBe('変更された項目がありません。')

    expect(seen).toHaveLength(0)
  })

  it('[OAV-13] 数量だけ変えると数量だけを送る', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PENDING.ID)
    await settle()
    const QUANTITY = PENDING.数量 + 5

    await quantityInput(wrapper).setValue(String(QUANTITY))
    await submit(wrapper)

    expect(seen).toEqual([{ 数量: QUANTITY }])
  })

  it('[OAV-14] 成行へ変えると単価の欄が消え、指成区分だけを送る', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await orderTypeButton(wrapper, 'MO').trigger('click')
    expect(limitPriceInput(wrapper).exists()).toBe(false)
    await submit(wrapper)

    expect(seen).toEqual([{ 指成区分: 'MO' }])
  })

  it('[OAV-15] 成行から指値へ変えると指成区分と単価を送る', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(WORKING.ID)
    await settle()
    const PRICE = '500.25'

    await orderTypeButton(wrapper, 'LO').trigger('click')
    expect(limitPriceInput(wrapper).element.value).toBe('')
    await limitPriceInput(wrapper).setValue(PRICE)
    await submit(wrapper)

    expect(seen).toEqual([{ 指成区分: 'LO', 指値単価: Number(PRICE) }])
  })

  it('[OAV-16] 市場区分と訂正理由を送る', async () => {
    const seen = recordAmend()
    const { wrapper } = await mountView(PENDING.ID)
    await settle()
    const scope = MARKET_SCOPE_OPTIONS.find((option) => option.value !== PENDING.発注範囲).value
    const REASON = 'お客様申出'

    await find(wrapper, 'order-amend-market-scope').setValue(scope)
    await find(wrapper, 'order-amend-reason').setValue(REASON)
    await submit(wrapper)

    expect(seen).toEqual([{ 発注範囲: scope, 理由: REASON }])
  })

  it('[OAV-17] 未発注の訂正はその場で訂正した完了表示になる', async () => {
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await quantityInput(wrapper).setValue(String(PENDING.数量 + 5))
    await submit(wrapper)

    expect(exists(wrapper, 'order-amend-complete')).toBe(true)
    expect(find(wrapper, 'order-amend-complete-message').text()).toBe(
      `注文を訂正しました（注文ID: ${PENDING.ID}）`,
    )
    expect(find(wrapper, 'order-amend-complete-detail').text()).toBe(
      `未発注の注文 #${PENDING.ID} をその場で訂正しました。`,
    )
    expect(exists(wrapper, 'order-amend-form')).toBe(false)
    expect(exists(wrapper, 'order-amend-complete-warnings')).toBe(false)
  })

  it('[OAV-18] 発注済みの訂正は原注文と訂正注文の番号を出す', async () => {
    const { wrapper } = await mountView(WORKING.ID)
    await settle()

    await quantityInput(wrapper).setValue(String(WORKING.数量 + 100))
    await submit(wrapper)

    const detail = find(wrapper, 'order-amend-complete-detail').text()
    expect(detail).toContain(`原注文 #${WORKING.ID}`)
    expect(detail).toContain(`訂正注文 #${MAX_ID + 1}`)
  })

  it('[OAV-19] 応答の警告を完了表示に並べる', async () => {
    const WARNINGS = ['注意1', '注意2']
    recordAmend({ warnings: WARNINGS })
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await quantityInput(wrapper).setValue(String(PENDING.数量 + 5))
    await submit(wrapper)

    expect(
      find(wrapper, 'order-amend-complete-warnings')
        .findAll('li')
        .map((li) => li.text()),
    ).toEqual(WARNINGS)
  })

  it('[OAV-20] 訂正が 400 ならフォーム内に理由が出て入力が残る', async () => {
    const REASON = '訂正を受け付けられません'
    server.use(http.post(AMEND, () => HttpResponse.json({ detail: REASON }, { status: 400 })))
    const { wrapper } = await mountView(PENDING.ID)
    await settle()
    const QUANTITY = String(PENDING.数量 + 5)

    await quantityInput(wrapper).setValue(QUANTITY)
    await submit(wrapper)

    expect(find(wrapper, 'order-amend-submit-error').text()).toBe(REASON)
    expect(exists(wrapper, 'order-amend-complete')).toBe(false)
    expect(quantityInput(wrapper).element.value).toBe(QUANTITY)
  })

  it('[OAV-21] 送信中は登録ボタンと戻るが押せない', async () => {
    const release = gate('post', AMEND)
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await quantityInput(wrapper).setValue(String(PENDING.数量 + 5))
    await find(wrapper, 'order-amend-form').trigger('submit')
    await flushPromises()

    const button = find(wrapper, 'order-amend-submit')
    expect(button.text()).toBe('登録中…')
    expect(button.attributes('disabled')).toBeDefined()
    expect(find(wrapper, 'order-amend-back').attributes('disabled')).toBeDefined()

    release()
    await settle()
  })

  it('[OAV-22] URL を直接開いたときの「戻る」は注文照会へ移る', async () => {
    const { wrapper, router } = await mountView(PENDING.ID)
    await settle()

    await find(wrapper, 'order-amend-back').trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('order-inquiry')
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[OAV-23] 注文照会から来たときは履歴を戻り検索条件が残る', async () => {
    const FROM = `${INQUIRY_PATH}?branch_code=123`
    const { wrapper, router } = await mountView(PENDING.ID, { from: FROM })
    await settle()

    await quantityInput(wrapper).setValue(String(PENDING.数量 + 5))
    await submit(wrapper)
    await find(wrapper, 'order-amend-back-to-list').trigger('click')
    await settle()

    expect(router.currentRoute.value.path).toBe(INQUIRY_PATH)
    expect(router.currentRoute.value.query).toEqual({ branch_code: '123' })
  })

  it('[OAV-24] ルートの注文 ID が変わると読み直して入力欄を入れ替える', async () => {
    const { wrapper, router } = await mountView(PENDING.ID)
    await settle()
    expect(quantityInput(wrapper).element.value).toBe(String(PENDING.数量))

    await router.push(`/orders/${WORKING.ID}/amend`)
    await settle()

    expect(find(wrapper, 'order-amend-description').text()).toContain(`注文ID #${WORKING.ID}`)
    expect(quantityInput(wrapper).element.value).toBe(String(WORKING.数量))
    expect(orderTypeButton(wrapper, WORKING.指成区分).attributes('aria-pressed')).toBe('true')
  })
})

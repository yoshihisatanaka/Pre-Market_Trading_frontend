import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { customers } from '@/mocks/fixtures/customers'
import { symbols } from '@/mocks/fixtures/symbols'
import { latestUsdFxRate } from '@/mocks/fixtures/fx'
import { FIRST_ORDER_ID, orderMessages } from '@/mocks/fixtures/orderEntry'
import { EXPIRY_OPTION_COUNT } from '@/utils/orderEntryForm'
import OrderEntryView from './OrderEntryView.vue'

// シナリオ: docs/unit/views-order-entry-view.md（タイトル先頭の [NOV-xx] が対応 ID）

const PATH = '/orders/new'
const BLACKOUT_PATH = '*/api/masters/blackout-dates'
const SUSPENSION_PATH = '*/api/operations/order-suspensions'
const VALIDATE_PATH = '*/api/orders/validate'
const CREATE_PATH = '*/api/orders'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

// 既定の顧客（警告なし）と警告の出る顧客。フィクスチャから引く
const plainCustomer = customers.find((row) => row.口座番号 === 1230004)
const cautionCustomer = customers.find((row) => row.口座番号 === 1230001)
const aapl = symbols.find((row) => row.Ticker === 'AAPL')

const Page = { render: () => h('div') }

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(PATH)
  const wrapper = mount(OrderEntryView, {
    global: { plugins: [createPinia(), router], stubs: { teleport: true } },
  })
  return { wrapper, router }
}

/** 条件が満たされるまで待つ（照会の待ち・事前検証・登録と非同期が重なるため） */
async function until(predicate, timeoutMs = 3000) {
  const started = Date.now()
  for (;;) {
    await flushPromises()
    if (predicate()) return
    if (Date.now() - started > timeoutMs) throw new Error('until: 条件が満たされなかった')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function gate(method, path) {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async () => {
      await promise
    }),
  )
  return { release }
}

/** 送られた本文を控える（応答は既定ハンドラに任せる） */
function recordBodies(method, path) {
  const bodies = []
  server.use(
    http[method](path, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

const byTestId = (wrapper, id) => wrapper.find(`[data-testid="${id}"]`)

async function formReady(wrapper) {
  await until(() => byTestId(wrapper, 'order-entry-form').exists())
}

/** 注文を一通り入れる（売買を省くと未選択のまま） */
async function fillOrder(wrapper, { customer = plainCustomer, ticker = 'AAPL', side = '3' } = {}) {
  await byTestId(wrapper, 'order-entry-branch').setValue(customer.部店コード)
  await byTestId(wrapper, 'order-entry-account').setValue(String(customer.口座番号))
  await byTestId(wrapper, 'order-entry-ticker').setValue(ticker)
  if (side) await byTestId(wrapper, 'order-entry-side').find(`[data-value="${side}"]`).trigger('click')
  await byTestId(wrapper, 'order-entry-quantity').setValue('10')
}

async function submit(wrapper) {
  await byTestId(wrapper, 'order-entry-form').trigger('submit')
}

async function toConfirm(wrapper, options) {
  await fillOrder(wrapper, options)
  await submit(wrapper)
  await until(() => byTestId(wrapper, 'order-entry-confirm').exists())
}

describe('OrderEntryView', () => {
  it('[NOV-01] 初期読み込み中はローディングだけを出す', async () => {
    const { release } = gate('get', BLACKOUT_PATH)
    const { wrapper } = await mountView()
    await flushPromises()

    expect(byTestId(wrapper, 'order-entry-loading').exists()).toBe(true)
    expect(byTestId(wrapper, 'order-entry-form').exists()).toBe(false)
    expect(byTestId(wrapper, 'order-entry-error').exists()).toBe(false)
    expect(byTestId(wrapper, 'order-entry-empty').exists()).toBe(false)
    release()
  })

  it('[NOV-02] 初期読み込みの失敗で理由と再試行を出す', async () => {
    server.use(http.get(BLACKOUT_PATH, () => HttpResponse.json({ detail: SERVER_ERROR }, { status: 500 })))
    const { wrapper } = await mountView()
    await until(() => byTestId(wrapper, 'order-entry-error').exists())

    expect(byTestId(wrapper, 'order-entry-error').text()).toContain(SERVER_ERROR)
    expect(byTestId(wrapper, 'order-entry-retry').exists()).toBe(true)
    expect(byTestId(wrapper, 'order-entry-form').exists()).toBe(false)
  })

  it('[NOV-03] 再試行でフォームが出る', async () => {
    server.use(
      http.get(BLACKOUT_PATH, () => HttpResponse.json({ detail: SERVER_ERROR }, { status: 500 }), {
        once: true,
      }),
    )
    const { wrapper } = await mountView()
    await until(() => byTestId(wrapper, 'order-entry-error').exists())

    await byTestId(wrapper, 'order-entry-retry').trigger('click')
    await formReady(wrapper)
  })

  it('[NOV-04] 営業日が 1 日も無ければ空表示を出す', async () => {
    const today = new Date()
    const rows = Array.from({ length: 46 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
      return { ID: i + 1, 受注不可日: ymd, 備考: '' }
    })
    server.use(
      http.get(BLACKOUT_PATH, () =>
        HttpResponse.json({ total: rows.length, limit: 50, offset: 0, blackout_dates: rows }),
      ),
    )
    const { wrapper } = await mountView()
    await until(() => byTestId(wrapper, 'order-entry-empty').exists())

    expect(byTestId(wrapper, 'order-entry-empty').text()).toContain('期間指定に選べる営業日がありません。')
    expect(byTestId(wrapper, 'order-entry-form').exists()).toBe(false)
  })

  it('[NOV-05] フォームの初期表示', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await until(() => byTestId(wrapper, 'order-entry-order-person').element.value !== '')

    const options = byTestId(wrapper, 'order-entry-expiry').findAll('option')
    expect(options).toHaveLength(EXPIRY_OPTION_COUNT)
    expect(options[0].text()).toMatch(/^当日中（\d+\/\d+）$/)
    expect(byTestId(wrapper, 'order-entry-expiry').element.value).toBe(options[0].element.value)
    expect(byTestId(wrapper, 'order-entry-no-permission').exists()).toBe(false)
    expect(byTestId(wrapper, 'order-entry-suspended').exists()).toBe(false)
  })

  it('[NOV-06] 発注権限が無ければ帯を出して送信を止める', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(noOperationOperator)))
    const { wrapper } = await mountView()
    await until(() => byTestId(wrapper, 'order-entry-no-permission').exists())

    expect(byTestId(wrapper, 'order-entry-no-permission').text()).toContain('発注権限がありません')
    expect(byTestId(wrapper, 'order-entry-submit').attributes('disabled')).toBeDefined()
  })

  it('[NOV-07] 全体停止中は帯を出して送信を止める', async () => {
    server.use(
      http.get(SUSPENSION_PATH, () =>
        HttpResponse.json({ 発注停止中: true, 全体停止中: true, 停止中の対象: ['ALL'], targets: [] }),
      ),
    )
    const { wrapper } = await mountView()
    await until(() => byTestId(wrapper, 'order-entry-suspended').exists())

    expect(byTestId(wrapper, 'order-entry-suspended').text()).toContain('新規の注文入力を停止しています')
    expect(byTestId(wrapper, 'order-entry-submit').attributes('disabled')).toBeDefined()
  })

  it('[NOV-08] 口座番号とティッカーの照会結果を出す', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper, { side: '' })

    await until(
      () =>
        byTestId(wrapper, 'order-entry-account-hint').exists() &&
        byTestId(wrapper, 'order-entry-account-hint').text() === plainCustomer.顧客名 &&
        byTestId(wrapper, 'order-entry-ticker-hint').exists() &&
        byTestId(wrapper, 'order-entry-ticker-hint').text() === aapl.銘柄名_英字,
    )
    expect(byTestId(wrapper, 'order-entry-customer-bar').exists()).toBe(true)

    await byTestId(wrapper, 'order-entry-account').setValue('1239999')
    await byTestId(wrapper, 'order-entry-ticker').setValue('ZZZZZ')
    await until(
      () =>
        byTestId(wrapper, 'order-entry-account-hint').exists() &&
        byTestId(wrapper, 'order-entry-account-hint').text() === '該当なし' &&
        byTestId(wrapper, 'order-entry-ticker-hint').exists() &&
        byTestId(wrapper, 'order-entry-ticker-hint').text() === '銘柄なし',
    )
  })

  it('[NOV-09] 打ってすぐ送信しても照会してから検証する', async () => {
    const bodies = recordBodies('post', VALIDATE_PATH)
    const { wrapper } = await mountView()
    await formReady(wrapper)

    await toConfirm(wrapper)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].銘柄コード).toBe(aapl.銘柄コード)
  })

  it('[NOV-10] 売買区分が未選択なら事前検証を呼ばない', async () => {
    const bodies = recordBodies('post', VALIDATE_PATH)
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper, { side: '' })
    await submit(wrapper)

    await until(() => wrapper.text().includes('売買区分を選択してください。'))
    expect(bodies).toHaveLength(0)
  })

  it('[NOV-11] サーバの errors を入力エラーの帯に出す', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper, { ticker: 'BRK.B' })
    await submit(wrapper)

    await until(() => byTestId(wrapper, 'order-entry-errors').exists())
    expect(byTestId(wrapper, 'order-entry-errors').text()).toContain(orderMessages.prohibited)
    expect(byTestId(wrapper, 'order-entry-confirm').exists()).toBe(false)
  })

  it('[NOV-12] 警告は強制区分なしでは進まない', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper, { customer: cautionCustomer })
    await submit(wrapper)

    await until(() => byTestId(wrapper, 'order-entry-warnings').exists())
    expect(byTestId(wrapper, 'order-entry-warnings').text()).toContain(
      orderMessages.complianceRank(cautionCustomer.コンプラランク),
    )
    expect(byTestId(wrapper, 'order-entry-forced-note').text()).toContain(
      'フロコン警告あり — 確認の上チェック',
    )
    expect(byTestId(wrapper, 'order-entry-confirm').exists()).toBe(false)
  })

  it('[NOV-13] 強制区分を付けて送り直すと確認へ進む', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper, { customer: cautionCustomer })
    await submit(wrapper)
    await until(() => byTestId(wrapper, 'order-entry-warnings').exists())

    await byTestId(wrapper, 'order-entry-forced').setValue(true)
    await submit(wrapper)
    await until(() => byTestId(wrapper, 'order-entry-confirm').exists())
    expect(byTestId(wrapper, 'order-entry-confirmed-warnings').text()).toContain(
      orderMessages.complianceRank(cautionCustomer.コンプラランク),
    )
  })

  it('[NOV-14] 確認画面の読み上げと概算、最終確認まで確定できない', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await toConfirm(wrapper)
    await until(() => byTestId(wrapper, 'order-readback-estimate-jpy').text().includes('円'))

    expect(byTestId(wrapper, 'order-readback-customer').text()).toBe(plainCustomer.顧客名)
    expect(byTestId(wrapper, 'order-readback-symbol').text()).toContain('AAPL')
    expect(byTestId(wrapper, 'order-readback-price').text()).toBe('成行')
    expect(byTestId(wrapper, 'order-readback-quantity').text()).toBe('10 株')

    const usd = Math.round(10 * aapl.前日終値 * 100) / 100
    const jpy = Math.round(usd * latestUsdFxRate.為替レート)
    expect(byTestId(wrapper, 'order-readback-estimate-usd').text()).toBe(
      `${new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 2 }).format(usd)} ドル`,
    )
    expect(byTestId(wrapper, 'order-readback-estimate-jpy').text()).toBe(
      `${new Intl.NumberFormat('ja-JP').format(jpy)} 円`,
    )
    expect(byTestId(wrapper, 'order-readback-estimate-note').text()).toContain('USD/JPY 150.25')

    const confirm = byTestId(wrapper, 'order-entry-confirm-submit')
    expect(confirm.attributes('disabled')).toBeDefined()
    await byTestId(wrapper, 'order-entry-final-check').setValue(true)
    expect(confirm.attributes('disabled')).toBeUndefined()
  })

  it('[NOV-15] 確定の success:false は理由の帯を出して留まる', async () => {
    server.use(
      http.post(CREATE_PATH, () =>
        HttpResponse.json({
          success: false,
          order_id: null,
          message: orderMessages.rejected,
          errors: ['残高が不足しています。'],
          warnings: [],
        }),
      ),
    )
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await toConfirm(wrapper)
    await byTestId(wrapper, 'order-entry-final-check').setValue(true)
    await byTestId(wrapper, 'order-entry-confirm-submit').trigger('click')

    await until(() => byTestId(wrapper, 'order-entry-rejected').exists())
    expect(byTestId(wrapper, 'order-entry-rejected').text()).toContain(orderMessages.rejected)
    expect(byTestId(wrapper, 'order-entry-rejected').text()).toContain('残高が不足しています。')
    expect(byTestId(wrapper, 'order-entry-confirm').exists()).toBe(true)
  })

  it('[NOV-16] 確定の 500 はエラーの帯を出して留まる', async () => {
    server.use(http.post(CREATE_PATH, () => HttpResponse.json({ detail: SERVER_ERROR }, { status: 500 })))
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await toConfirm(wrapper)
    await byTestId(wrapper, 'order-entry-final-check').setValue(true)
    await byTestId(wrapper, 'order-entry-confirm-submit').trigger('click')

    await until(() => byTestId(wrapper, 'order-entry-submit-error').exists())
    expect(byTestId(wrapper, 'order-entry-submit-error').text()).toContain(SERVER_ERROR)
    expect(byTestId(wrapper, 'order-entry-confirm').exists()).toBe(true)
  })

  it('[NOV-17] 確定すると完了画面に注文 ID と受付文言を出す', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await toConfirm(wrapper)
    await byTestId(wrapper, 'order-entry-final-check').setValue(true)
    await byTestId(wrapper, 'order-entry-confirm-submit').trigger('click')

    await until(() => byTestId(wrapper, 'order-entry-complete').exists())
    expect(byTestId(wrapper, 'order-entry-order-id').text()).toBe(`注文ID #${FIRST_ORDER_ID}`)
    expect(byTestId(wrapper, 'order-entry-complete-message').text()).toContain(orderMessages.created)
  })

  it('[NOV-18] 同じ顧客で新規注文は部店・口座番号と顧客バーを残す', async () => {
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await toConfirm(wrapper)
    await byTestId(wrapper, 'order-entry-final-check').setValue(true)
    await byTestId(wrapper, 'order-entry-confirm-submit').trigger('click')
    await until(() => byTestId(wrapper, 'order-entry-complete').exists())

    await byTestId(wrapper, 'order-entry-new-same-customer').trigger('click')
    await formReady(wrapper)
    expect(byTestId(wrapper, 'order-entry-branch').element.value).toBe(plainCustomer.部店コード)
    expect(byTestId(wrapper, 'order-entry-account').element.value).toBe(String(plainCustomer.口座番号))
    expect(byTestId(wrapper, 'order-entry-customer-bar').exists()).toBe(true)
    expect(byTestId(wrapper, 'order-entry-ticker').element.value).toBe('')
    expect(byTestId(wrapper, 'order-entry-quantity').element.value).toBe('')
  })

  it('[NOV-19] 送信と確定を続けて押しても 1 回ずつしか送らない', async () => {
    const validated = recordBodies('post', VALIDATE_PATH)
    const created = recordBodies('post', CREATE_PATH)
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper)
    await submit(wrapper)
    await submit(wrapper)
    await until(() => byTestId(wrapper, 'order-entry-confirm').exists())

    await byTestId(wrapper, 'order-entry-final-check').setValue(true)
    const confirm = byTestId(wrapper, 'order-entry-confirm-submit')
    await confirm.trigger('click')
    await confirm.trigger('click')
    await until(() => byTestId(wrapper, 'order-entry-complete').exists())

    expect(validated).toHaveLength(1)
    expect(created).toHaveLength(1)
  })

  it('[NOV-20] 事前検証の 500 はエラーの帯を出して入力値を残す', async () => {
    server.use(http.post(VALIDATE_PATH, () => HttpResponse.json({ detail: SERVER_ERROR }, { status: 500 })))
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper)
    await submit(wrapper)

    await until(() => byTestId(wrapper, 'order-entry-validate-error').exists())
    expect(byTestId(wrapper, 'order-entry-validate-error').text()).toContain(SERVER_ERROR)
    expect(byTestId(wrapper, 'order-entry-form').exists()).toBe(true)
    expect(byTestId(wrapper, 'order-entry-quantity').element.value).toBe('10')
  })
})

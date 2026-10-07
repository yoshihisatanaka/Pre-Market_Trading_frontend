import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator, supervisorOperator } from '@/mocks/fixtures/currentOperator'
import { customers } from '@/mocks/fixtures/customers'
import { symbols } from '@/mocks/fixtures/symbols'
import { fxRates } from '@/mocks/fixtures/fxRates'

// GET /masters/fx/latest が返す行（基準日の昇順に並んだフィクスチャの末尾）
const latestUsdFxRate = fxRates.at(-1)
import { FIRST_ORDER_ID, orderMessages } from '@/mocks/fixtures/orderEntry'
import { codeEntries } from '@/mocks/fixtures/codes'
import { useCodesStore } from '@/stores/codes'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { EXPIRY_OPTION_COUNT } from '@/utils/orderEntryForm'
import {
  DEPOSIT_CATEGORY,
  ORDER_FORM_DEFAULTS,
  ORDER_PERSON_MAX_LENGTH,
  SIDE,
} from '@/utils/orderEntryOptions'
import OrderEntryView from './OrderEntryView.vue'

// シナリオ: docs/unit/views-order-entry-view.md（タイトル先頭の [NOV-xx] が対応 ID）

const PATH = '/orders/new'
const CUSTOMER_DETAIL_PATH = '/customers/1/order-entry'
const BLACKOUT_PATH = '*/api/masters/blackout-dates'
const SUSPENSION_PATH = '*/api/operations/order-suspensions'
const VALIDATE_PATH = '*/api/orders/validate'
const CREATE_PATH = '*/api/orders'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

// 既定の顧客（警告なし）と警告の出る顧客。フィクスチャから引く
const plainCustomer = customers.find((row) => row.口座番号 === 1230004)
const cautionCustomer = customers.find((row) => row.口座番号 === 1230001)
const aapl = symbols.find((row) => row.Ticker === 'AAPL')

/*
 * 受注者（1〜4 文字）。単体テストの社員コード（VITE_USER_CODE / /auth/me の操作者コード）は
 * どれも 5 文字以上で受注者の初期値にならないので、送信まで進む行は手で入れる
 */
const ORDER_PERSON = 'T'.padEnd(ORDER_PERSON_MAX_LENGTH, '0')

const Page = { render: () => h('div') }

/**
 * @param {Record<string, string>} [query] 顧客詳細からの引き継ぎ（NOV-22〜24）。既定はクエリなし
 * @param {string} [path] 既定は /orders/new。顧客詳細の子ルートとして描くときは CUSTOMER_DETAIL_PATH（NOV-28）
 */
async function mountView(query = {}, path = PATH) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      // 画面はルート名で顧客詳細の子ルートかを見分ける（router/index.js と同じ名前）
      { path: '/customers/:customerId/order-entry', name: 'customer-order-entry', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path, query })
  // App.vue はコードマスタを読み終えてから画面を描く。それに合わせて先に読んでおく
  const pinia = createPinia()
  await useCodesStore(pinia).load()
  const wrapper = mount(OrderEntryView, {
    global: { plugins: [pinia, router], stubs: { teleport: true } },
  })
  return { wrapper, router, pinia }
}

/** /auth/me を読み終えるまで待つ（受注者の初期値はそのあとで決まる） */
async function operatorReady(pinia) {
  const operator = useCurrentOperatorStore(pinia)
  await until(() => operator.operator !== null || operator.error !== null)
  await flushPromises()
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
async function fillOrder(
  wrapper,
  { customer = plainCustomer, ticker = 'AAPL', side = '3', orderPerson = ORDER_PERSON } = {},
) {
  await byTestId(wrapper, 'order-entry-branch').setValue(customer.部店コード)
  await byTestId(wrapper, 'order-entry-account').setValue(String(customer.口座番号))
  await byTestId(wrapper, 'order-entry-ticker').setValue(ticker)
  if (side) await byTestId(wrapper, 'order-entry-side').find(`[data-value="${side}"]`).trigger('click')
  await byTestId(wrapper, 'order-entry-quantity').setValue('10')
  await byTestId(wrapper, 'order-entry-order-person').setValue(orderPerson)
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
    const { wrapper, pinia } = await mountView()
    await formReady(wrapper)
    await operatorReady(pinia)

    // 既定モックの社員コード（admin）は 5 文字で受注者に入らないので、空のまま始まる
    expect(useCurrentOperatorStore(pinia).operator.operatorCode.length).toBeGreaterThan(
      ORDER_PERSON_MAX_LENGTH,
    )
    expect(byTestId(wrapper, 'order-entry-order-person').element.value).toBe('')

    const options = byTestId(wrapper, 'order-entry-expiry').findAll('option')
    expect(options).toHaveLength(EXPIRY_OPTION_COUNT)
    expect(options[0].text()).toMatch(/^当日中（\d+\/\d+）$/)
    expect(byTestId(wrapper, 'order-entry-expiry').element.value).toBe(options[0].element.value)
    expect(byTestId(wrapper, 'order-entry-no-permission').exists()).toBe(false)
    expect(byTestId(wrapper, 'order-entry-suspended').exists()).toBe(false)
  })

  it('[NOV-25] 社員コードが受注者の最大文字数以内なら受注者の初期値に入る', async () => {
    const shortCode = 'A'.padEnd(ORDER_PERSON_MAX_LENGTH, '1')
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ ...supervisorOperator, 操作者コード: shortCode }),
      ),
    )
    const { wrapper, pinia } = await mountView()
    await formReady(wrapper)
    await operatorReady(pinia)

    await until(() => byTestId(wrapper, 'order-entry-order-person').element.value === shortCode)
  })

  it('[NOV-26] 受注者が最大文字数を超えると文言を出し、事前検証を呼ばない', async () => {
    const bodies = recordBodies('post', VALIDATE_PATH)
    const { wrapper } = await mountView()
    await formReady(wrapper)
    await fillOrder(wrapper, { orderPerson: 'X'.repeat(ORDER_PERSON_MAX_LENGTH + 1) })
    await submit(wrapper)

    await until(() =>
      wrapper.text().includes(`受注者は${ORDER_PERSON_MAX_LENGTH}文字以内で入力してください。`),
    )
    expect(bodies).toHaveLength(0)
    expect(byTestId(wrapper, 'order-entry-confirm').exists()).toBe(false)
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
    expect(bodies[0].受注者).toBe(ORDER_PERSON)
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

  it('[NOV-21] 注文種別の選択肢はコードマスタ VWAP区分 から来て、既定は 0（通常）', async () => {
    const { wrapper } = await mountView()
    await flushPromises()

    const buttons = byTestId(wrapper, 'order-entry-vwap').findAll('button')
    expect(
      buttons.map((button) => ({ value: button.attributes('data-value'), label: button.text() })),
    ).toEqual(codeEntries('VWAP区分').map(({ code, label }) => ({ value: code, label })))
    expect(buttons.find((button) => button.attributes('data-selected') === 'true').text()).toBe(
      '通常',
    )
  })

  /** 顧客詳細の「新規注文」「買い」が組み立てるクエリ（警告の出る顧客・AAPL・買い・一般） */
  const handoverQuery = () => ({
    branch_code: cautionCustomer.部店コード,
    account_number: String(cautionCustomer.口座番号),
    // 小文字で来ても大文字に直して入る
    ticker: aapl.Ticker.toLowerCase(),
    side: 'buy',
    deposit: DEPOSIT_CATEGORY.GENERAL,
  })

  /** BaseSegmentedControl で選ばれているボタンの値（未選択なら undefined） */
  const selectedValue = (wrapper, testid) =>
    byTestId(wrapper, testid)
      .findAll('button')
      .find((button) => button.attributes('data-selected') === 'true')
      ?.attributes('data-value')

  it('[NOV-22] URL クエリで引き継いだ部店・口座番号・ティッカー・売買・預り区分が初期値に入る', async () => {
    const { wrapper } = await mountView(handoverQuery())
    await formReady(wrapper)

    expect(byTestId(wrapper, 'order-entry-branch').element.value).toBe(cautionCustomer.部店コード)
    expect(byTestId(wrapper, 'order-entry-account').element.value).toBe(
      String(cautionCustomer.口座番号),
    )
    expect(byTestId(wrapper, 'order-entry-ticker').element.value).toBe(aapl.Ticker)
    expect(selectedValue(wrapper, 'order-entry-side')).toBe(SIDE.BUY)
    expect(selectedValue(wrapper, 'order-entry-deposit-category')).toBe(DEPOSIT_CATEGORY.GENERAL)
  })

  it('[NOV-23] 引き継いだ顧客と銘柄は入力欄に触らなくても照会される', async () => {
    const { wrapper } = await mountView(handoverQuery())
    await formReady(wrapper)

    await until(
      () =>
        byTestId(wrapper, 'order-entry-customer-bar').exists() &&
        byTestId(wrapper, 'order-entry-ticker-hint').exists() &&
        byTestId(wrapper, 'order-entry-ticker-hint').text() === aapl.銘柄名_英字,
    )
    expect(byTestId(wrapper, 'order-entry-customer-name').text()).toBe(cautionCustomer.顧客名)
    expect(byTestId(wrapper, 'order-entry-account-hint').text()).toBe(cautionCustomer.顧客名)
  })

  it('[NOV-24] 読めない値は引き継がず既定のまま', async () => {
    const { wrapper } = await mountView({ account_number: '12a', side: 'hold', deposit: '9' })
    await formReady(wrapper)
    await flushPromises()

    expect(byTestId(wrapper, 'order-entry-account').element.value).toBe('')
    expect(selectedValue(wrapper, 'order-entry-side')).toBeUndefined()
    expect(selectedValue(wrapper, 'order-entry-deposit-category')).toBe(
      ORDER_FORM_DEFAULTS.depositCategory,
    )
    expect(byTestId(wrapper, 'order-entry-customer-bar').exists()).toBe(false)
  })

  it('[NOV-27] 預りの「売り」から引き継いだ数量（売却可能株数）が注文数量に入る', async () => {
    const sold = await mountView({ ...handoverQuery(), side: 'sell', quantity: '1500' })
    await formReady(sold.wrapper)

    expect(selectedValue(sold.wrapper, 'order-entry-side')).toBe(SIDE.SELL)
    expect(byTestId(sold.wrapper, 'order-entry-quantity').element.value).toBe('1,500')
    sold.wrapper.unmount()

    const unreadable = await mountView({ ...handoverQuery(), side: 'sell', quantity: 'abc' })
    await formReady(unreadable.wrapper)

    expect(byTestId(unreadable.wrapper, 'order-entry-quantity').element.value).toBe('')
  })

  it('[NOV-28] 顧客詳細の子ルートでは顧客バーを出さない（顧客カードは親が出す）', async () => {
    const { wrapper } = await mountView(handoverQuery(), CUSTOMER_DETAIL_PATH)
    await formReady(wrapper)

    // 照会が済んだことは口座番号の横の顧客名で見る
    await until(
      () =>
        byTestId(wrapper, 'order-entry-account-hint').exists() &&
        byTestId(wrapper, 'order-entry-account-hint').text() === cautionCustomer.顧客名,
    )
    expect(byTestId(wrapper, 'order-entry-customer-bar').exists()).toBe(false)
  })
})

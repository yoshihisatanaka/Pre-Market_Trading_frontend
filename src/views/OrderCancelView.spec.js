import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { formatQuantity } from '@/utils/format'
import { marketScopeLabel, orderPriceLabel, orderStatusLabel } from '@/utils/orderTypes'
import OrderCancelView from './OrderCancelView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態・取消不可の表示・取消の確定と完了表示・戻る導線を検証する。
 * 発注権限のガードは router のテスト（PMG）が見るので、ここでは通さない。
 */
const INQUIRY_PATH = '/orders/inquiry'
const DETAIL = '*/api/orders/:orderId'
const CANCEL = '*/api/orders/:orderId/cancel'

const byId = (id) => orderInquiryRows.find((row) => row.ID === id)
// 状況ごとの対象注文（フィクスチャの ID で引く）
const PENDING = byId(36) // 000 未発注
const WORKING = byId(34) // 003 注文中
const PARTIAL = byId(35) // 010 一部出来
const FILLED = byId(41) // 011 全部出来（取消できない）
const MISSING_ID = Math.max(...orderInquiryRows.map((row) => row.ID)) + 100

// 取消画面の売買は「買い / 売り」
const SIDE_LABELS = { 1: '売り', 3: '買い' }
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const Page = { render: () => h('div') }

/**
 * 取消画面を開く。from を渡すと、その URL から来た（history.state.back がある）状態にする。
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
      { path: '/orders/:orderId(\\d+)/cancel', name: 'order-cancel', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  if (from) await router.push(from)
  await router.push(`/orders/${id}/cancel`)

  const wrapper = mount(OrderCancelView, { global: { plugins: [createPinia(), router] } })
  return { wrapper, router }
}

/** 操作 → 通信 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const confirm = async (wrapper) => {
  await find(wrapper, 'order-cancel-submit').trigger('click')
  await settle()
}

const summaryPairs = (wrapper) => {
  const summary = find(wrapper, 'order-cancel-summary')
  const values = summary.findAll('dd').map((dd) => dd.text())
  return summary.findAll('dt').map((dt, index) => [dt.text(), values[index]])
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

const detailError = () =>
  http.get(DETAIL, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

// シナリオ: docs/unit/views-order-cancel-view.md
describe('OrderCancelView', () => {
  it('[OCV-01] 取得中はローディングだけが出る', async () => {
    const release = gate('get', DETAIL)
    const { wrapper } = await mountView(PENDING.ID)
    await flushPromises()

    expect(exists(wrapper, 'order-cancel-loading')).toBe(true)
    expect(exists(wrapper, 'order-cancel-summary')).toBe(false)
    expect(exists(wrapper, 'order-cancel-error')).toBe(false)
    expect(exists(wrapper, 'order-cancel-not-found')).toBe(false)

    release()
    await settle()
  })

  it('[OCV-02] 500 のときはエラーの理由と再試行が出て取消対象は出ない', async () => {
    server.use(detailError())
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    const error = find(wrapper, 'order-cancel-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'order-cancel-summary')).toBe(false)
  })

  it('[OCV-03] 無い注文は not-found と注文照会へ戻る導線を出す', async () => {
    const { wrapper } = await mountView(MISSING_ID)
    await settle()

    const notFound = find(wrapper, 'order-cancel-not-found')
    expect(notFound.text()).toContain('注文が見つかりませんでした。')
    expect(notFound.find('button').text()).toBe('注文照会へ戻る')
    expect(exists(wrapper, 'order-cancel-error')).toBe(false)
    expect(exists(wrapper, 'order-cancel-summary')).toBe(false)
  })

  it('[OCV-04] 再試行で取消対象が出る', async () => {
    server.use(detailError())
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    server.resetHandlers()
    await find(wrapper, 'order-cancel-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'order-cancel-error')).toBe(false)
    expect(exists(wrapper, 'order-cancel-summary')).toBe(true)
  })

  it('[OCV-05] 取消対象注文と状況が表示用の文言で出る', async () => {
    const raw = PARTIAL
    const remaining = raw.数量 - raw.出来数量
    const { wrapper } = await mountView(raw.ID)
    await settle()

    expect(find(wrapper, 'order-cancel-order-id').text()).toBe(`注文ID #${raw.ID}`)
    expect(summaryPairs(wrapper)).toEqual([
      ['銘柄', raw.Ticker],
      ['売買', SIDE_LABELS[raw.売買区分]],
      ['口座番号', String(raw.口座番号)],
      ['注文数量', `${formatQuantity(raw.数量)}株`],
      ['約定済数量', `${formatQuantity(raw.出来数量)}株`],
      ['取消対象（未約定残）', `${formatQuantity(remaining)}株`],
      ['価格', orderPriceLabel(raw.指成区分, raw.指値単価)],
      ['市場区分', marketScopeLabel(raw.発注範囲)],
    ])
    expect(find(wrapper, 'order-cancel-quantity').text()).toBe('1,800株')
    expect(find(wrapper, 'order-cancel-status').text()).toBe(orderStatusLabel(raw.処理状況))
  })

  it('[OCV-06] 出来の有無で取消後の扱いの説明が変わる', async () => {
    const partial = await mountView(PARTIAL.ID)
    await settle()
    expect(find(partial.wrapper, 'order-cancel-effect').text()).toBe(
      `約定済 ${formatQuantity(PARTIAL.出来数量)} 株は取り消されず、未約定残 ${formatQuantity(
        PARTIAL.数量 - PARTIAL.出来数量,
      )} 株だけを取消対象にします。`,
    )

    const pending = await mountView(PENDING.ID)
    await settle()
    expect(find(pending.wrapper, 'order-cancel-effect').text()).toBe(
      '約定済みの数量はなく、注文数量全体を取消対象にします。',
    )
  })

  it('[OCV-07] 取消できない状況は理由を出して確定ボタンを出さない', async () => {
    const { wrapper } = await mountView(FILLED.ID)
    await settle()

    expect(find(wrapper, 'order-cancel-locked').text()).toBe(
      `この注文は取消できません（処理状況: ${orderStatusLabel(FILLED.処理状況)}）。`,
    )
    expect(exists(wrapper, 'order-cancel-submit')).toBe(false)
    expect(exists(wrapper, 'order-cancel-back')).toBe(true)
  })

  it('[OCV-08] 訂正中断（141）の注文は取消できる', async () => {
    const INTERRUPTED = '141'
    server.use(
      http.get(DETAIL, () =>
        HttpResponse.json({
          order: { ...PENDING, 処理状況: INTERRUPTED },
          executions: [],
          events: [],
        }),
      ),
    )
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    expect(exists(wrapper, 'order-cancel-locked')).toBe(false)
    expect(exists(wrapper, 'order-cancel-submit')).toBe(true)
    expect(find(wrapper, 'order-cancel-status').text()).toBe(orderStatusLabel(INTERRUPTED))
    expect(find(wrapper, 'order-cancel-status').text()).toBe('訂正中断')
  })

  it('[OCV-09] 未発注の取消は取消済の完了表示になる', async () => {
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await confirm(wrapper)

    expect(exists(wrapper, 'order-cancel-complete')).toBe(true)
    expect(find(wrapper, 'order-cancel-complete-message').text()).toBe(
      `注文を取り消しました（注文ID: ${PENDING.ID}）`,
    )
    expect(exists(wrapper, 'order-cancel-summary')).toBe(false)
    expect(exists(wrapper, 'order-cancel-complete-warnings')).toBe(false)
  })

  it('[OCV-10] 注文中の取消は取消依頼の完了表示になる', async () => {
    const { wrapper } = await mountView(WORKING.ID)
    await settle()

    await confirm(wrapper)

    expect(find(wrapper, 'order-cancel-complete-message').text()).toBe(
      `取消依頼を受け付けました（注文ID: ${WORKING.ID}）`,
    )
  })

  it('[OCV-11] 応答の警告を完了表示に並べる', async () => {
    const WARNINGS = ['注意1', '注意2']
    server.use(
      http.post(CANCEL, ({ params }) =>
        HttpResponse.json({
          success: true,
          order_id: Number(params.orderId),
          status: '034',
          message: '取り消しました',
          errors: [],
          warnings: WARNINGS,
        }),
      ),
    )
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await confirm(wrapper)

    expect(
      find(wrapper, 'order-cancel-complete-warnings')
        .findAll('li')
        .map((li) => li.text()),
    ).toEqual(WARNINGS)
  })

  it('[OCV-12] 取消が 400 なら理由が出て確定ボタンが残る', async () => {
    const REASON = '取消を受け付けられません'
    server.use(http.post(CANCEL, () => HttpResponse.json({ detail: REASON }, { status: 400 })))
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await confirm(wrapper)

    expect(find(wrapper, 'order-cancel-submit-error').text()).toBe(REASON)
    expect(exists(wrapper, 'order-cancel-complete')).toBe(false)
    expect(exists(wrapper, 'order-cancel-submit')).toBe(true)
    expect(exists(wrapper, 'order-cancel-summary')).toBe(true)
  })

  it('[OCV-13] 取消中は確定ボタンと戻るが押せない', async () => {
    const release = gate('post', CANCEL)
    const { wrapper } = await mountView(PENDING.ID)
    await settle()

    await find(wrapper, 'order-cancel-submit').trigger('click')
    await flushPromises()

    const button = find(wrapper, 'order-cancel-submit')
    expect(button.text()).toBe('取消中…')
    expect(button.attributes('disabled')).toBeDefined()
    expect(find(wrapper, 'order-cancel-back').attributes('disabled')).toBeDefined()

    release()
    await settle()
  })

  it('[OCV-14] URL を直接開いたときの「戻る」は注文照会へ移る', async () => {
    const { wrapper, router } = await mountView(PENDING.ID)
    await settle()

    await find(wrapper, 'order-cancel-back').trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('order-inquiry')
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[OCV-15] 注文照会から来たときは取消後に履歴を戻り検索条件が残る', async () => {
    const FROM = `${INQUIRY_PATH}?branch_code=123`
    const { wrapper, router } = await mountView(PENDING.ID, { from: FROM })
    await settle()

    await confirm(wrapper)
    await find(wrapper, 'order-cancel-back-to-list').trigger('click')
    await settle()

    expect(router.currentRoute.value.path).toBe(INQUIRY_PATH)
    expect(router.currentRoute.value.query).toEqual({ branch_code: '123' })
  })
})

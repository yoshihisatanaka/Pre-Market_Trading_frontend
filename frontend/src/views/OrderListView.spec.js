import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderListResponse } from '@/mocks/fixtures/orders'
import OrderListView from './OrderListView.vue'

/*
 * 画面テストの見本。
 * 実際の Pinia ストア + MSW(node) を通し、ローディング / エラー / 空 / データあり の
 * 4状態が正しく出し分けられることを検証する。API 層をモックで置き換えない。
 */
function mountView() {
  return mount(OrderListView, {
    global: { plugins: [createPinia()] },
  })
}

// シナリオ: docs/unit/views-order-list-view.md
describe('OrderListView', () => {
  it('[OLV-01] 取得中はローディングを表示する', async () => {
    const wrapper = mountView()
    // onMounted で loading=true になった直後の再描画だけ待つ（API 応答はまだ返っていない）
    await nextTick()

    expect(wrapper.find('[data-testid="orders-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="orders-table"]').exists()).toBe(false)
  })

  it('[OLV-02] 取得成功時はフィクスチャの件数分の行を表示する', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="orders-loading"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="data-table-row"]')).toHaveLength(
      orderListResponse.items.length,
    )
    // 表示整形（売買ラベル・価格・ステータス）まで確認する
    const firstRow = wrapper.find('[data-testid="data-table-row"]').text()
    expect(firstRow).toContain('AAPL')
    expect(firstRow).toContain('買')
    expect(firstRow).toContain('$227.52')
    expect(firstRow).toContain('約定済')
  })

  it('[OLV-03] API がエラーを返したときはメッセージと再試行ボタンを表示する', async () => {
    server.use(
      http.get('*/api/orders', () =>
        HttpResponse.json({ message: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()

    const error = wrapper.find('[data-testid="orders-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('サーバーでエラーが発生しました。')
    expect(error.find('button').text()).toBe('再試行')
    expect(wrapper.find('[data-testid="orders-table"]').exists()).toBe(false)
  })

  it('[OLV-04] 注文が 0 件のときは空状態を表示する', async () => {
    server.use(http.get('*/api/orders', () => HttpResponse.json({ items: [], total: 0 })))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="orders-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="orders-table"]').exists()).toBe(false)
  })

  it('[OLV-05] 再読み込みボタンで再取得する', async () => {
    server.use(
      http.get('*/api/orders', () => HttpResponse.json({ items: [], total: 0 }), { once: true }),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="orders-empty"]').exists()).toBe(true)

    // 2回目は既定ハンドラ（フィクスチャ3件）に戻る
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="data-table-row"]')).toHaveLength(
      orderListResponse.items.length,
    )
  })
})

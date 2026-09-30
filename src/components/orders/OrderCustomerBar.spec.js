import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import OrderCustomerBar from './OrderCustomerBar.vue'

/*
 * 部品のテスト。顧客（src/api/customers.js の Customer のうち使う項目）を props で受け、
 * 注意の表示 3 つと金額の整形を見る。
 */
function customer(overrides = {}) {
  return {
    customerName: '高橋 みどり',
    customerNameKana: 'ﾀｶﾊｼ ﾐﾄﾞﾘ',
    complianceRank: 'C',
    age: '40',
    tradingSuspended: false,
    cashJpy: 3500000,
    cashUsd: 12500.5,
    growthQuota: null,
    ...overrides,
  }
}

const mountBar = (overrides) => mount(OrderCustomerBar, { props: { customer: customer(overrides) } })
const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)

// シナリオ: docs/unit/components-orders-order-customer-bar.md
describe('OrderCustomerBar', () => {
  it('[NCB-01] 顧客名と顧客名カナを出す', () => {
    const wrapper = mountBar()

    expect(find(wrapper, 'order-entry-customer-name').text()).toBe(customer().customerName)
    expect(find(wrapper, 'order-entry-customer-bar').text()).toContain(customer().customerNameKana)
  })

  it('[NCB-02] コンプラランク A・B・Y・Z で要注意を出す', () => {
    for (const rank of ['A', 'B', 'Y', 'Z']) {
      const wrapper = mountBar({ complianceRank: rank })
      expect(find(wrapper, 'order-entry-customer-compliance').text(), rank).toBe(
        `コンプラ ${rank} 要注意`,
      )
    }
    expect(find(mountBar({ complianceRank: 'C' }), 'order-entry-customer-compliance').exists()).toBe(
      false,
    )
  })

  it('[NCB-03] 85 歳以上で高齢者を出す', () => {
    expect(find(mountBar({ age: '85' }), 'order-entry-customer-elderly').text()).toBe('85歳 高齢者')
    expect(find(mountBar({ age: '84' }), 'order-entry-customer-elderly').exists()).toBe(false)
    expect(find(mountBar({ age: '' }), 'order-entry-customer-elderly').exists()).toBe(false)
  })

  it('[NCB-04] 全取引停止を出す', () => {
    expect(find(mountBar({ tradingSuspended: true }), 'order-entry-customer-suspended').text()).toBe(
      '全取引停止',
    )
    expect(find(mountBar(), 'order-entry-customer-suspended').exists()).toBe(false)
  })

  it('[NCB-05] 金額を単位付きで整形し、null は —、0 は 0 円', () => {
    const wrapper = mountBar()
    expect(find(wrapper, 'order-entry-customer-cash-jpy').text()).toBe('3,500,000 円')
    expect(find(wrapper, 'order-entry-customer-cash-usd').text()).toBe('12,500.50 ドル')
    expect(find(wrapper, 'order-entry-customer-growth-quota').text()).toBe('—')

    expect(find(mountBar({ cashJpy: 0 }), 'order-entry-customer-cash-jpy').text()).toBe('0 円')
  })
})

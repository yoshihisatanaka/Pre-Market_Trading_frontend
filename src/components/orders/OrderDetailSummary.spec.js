import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import OrderDetailSummary from './OrderDetailSummary.vue'

const ITEMS = [
  { label: '注文ID', value: '#35' },
  { label: '銘柄', value: 'TSLA', testid: 'summary-symbol' },
  { label: '出来数量', value: '1,200株' },
]

const pairs = (wrapper) => {
  const labels = wrapper.findAll('dt').map((dt) => dt.text())
  const values = wrapper.findAll('dd').map((dd) => dd.text())
  return labels.map((label, index) => [label, values[index]])
}

// シナリオ: docs/unit/components-orders-order-detail-summary.md
describe('OrderDetailSummary', () => {
  it('[ODS-01] items の順に dt / dd の組が並ぶ', () => {
    const wrapper = mount(OrderDetailSummary, { props: { items: ITEMS } })

    expect(pairs(wrapper)).toEqual(ITEMS.map((item) => [item.label, item.value]))
  })

  it('[ODS-02] testid を付けた行の dd にだけ data-testid が付く', () => {
    const wrapper = mount(OrderDetailSummary, { props: { items: ITEMS } })
    const cells = wrapper.findAll('dd')

    expect(cells.map((dd) => dd.attributes('data-testid'))).toEqual(
      ITEMS.map((item) => item.testid),
    )
    expect(cells[0].attributes()).not.toHaveProperty('data-testid')
    expect(wrapper.find('[data-testid="summary-symbol"]').text()).toBe('TSLA')
  })

  it('[ODS-03] items が空なら dl だけが描かれる', () => {
    const wrapper = mount(OrderDetailSummary, { props: { items: [] } })

    expect(wrapper.element.tagName).toBe('DL')
    expect(wrapper.findAll('dt')).toHaveLength(0)
    expect(wrapper.findAll('dd')).toHaveLength(0)
  })

  it('[ODS-04] 渡した data-testid はルートの dl に付く', () => {
    const wrapper = mount(OrderDetailSummary, {
      props: { items: ITEMS },
      attrs: { 'data-testid': 'order-amend-summary' },
    })

    expect(wrapper.element.tagName).toBe('DL')
    expect(wrapper.attributes('data-testid')).toBe('order-amend-summary')
  })
})

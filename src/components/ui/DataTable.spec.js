import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DataTable from './DataTable.vue'

/*
 * 汎用部品のテストの見本。
 * 外部依存（store / API）を持たない部品は、props と slots の入出力だけを検証する。
 */
const columns = [
  { key: 'symbol', label: 'ティッカー' },
  { key: 'quantity', label: '数量', numeric: true },
]
const rows = [
  { id: 'r1', symbol: 'AAPL', quantity: 10 },
  { id: 'r2', symbol: 'MSFT', quantity: 5 },
]

// シナリオ: docs/unit/components-ui-data-table.md
describe('DataTable', () => {
  it('[DTB-01] columns のヘッダと rows の行を描画する', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })

    expect(wrapper.findAll('th').map((th) => th.text())).toEqual(['ティッカー', '数量'])
    expect(wrapper.findAll('[data-testid="data-table-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('AAPL')
  })

  it('[DTB-02] numeric 列のセルに numeric クラスが付く', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })

    const firstRowCells = wrapper.find('[data-testid="data-table-row"]').findAll('td')
    expect(firstRowCells[0].classes()).not.toContain('numeric')
    expect(firstRowCells[1].classes()).toContain('numeric')
  })

  it('[DTB-03] cell-<key> スロットでセルの表示を差し替えられる', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows },
      slots: {
        'cell-quantity': ({ value }) => `${value} 株`,
      },
    })

    expect(wrapper.text()).toContain('10 株')
    expect(wrapper.text()).toContain('5 株')
  })

  it('[DTB-04] rowKey で行のキーに使うプロパティを変えられる', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows: [{ code: 'x', symbol: 'NVDA', quantity: 1 }], rowKey: 'code' },
    })

    expect(wrapper.findAll('[data-testid="data-table-row"]')).toHaveLength(1)
  })
})

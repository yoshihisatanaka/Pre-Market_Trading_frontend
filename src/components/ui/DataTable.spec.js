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

  it('[DTB-05] rowClass が返したクラスが行に付く', () => {
    const wrapper = mount(DataTable, {
      props: {
        columns,
        rows,
        // 「どの行を目立たせるか」の判定は呼び出し側にある。この部品は戻り値を付けるだけ
        rowClass: (row) => (row.symbol === 'AAPL' ? 'is-marked' : null),
      },
    })

    const [first, second] = wrapper.findAll('[data-testid="data-table-row"]')
    expect(first.classes()).toContain('is-marked')
    expect(second.classes()).not.toContain('is-marked')
  })

  it('[DTB-06] rowClass を渡さないと行に追加のクラスが付かない', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })

    for (const row of wrapper.findAll('[data-testid="data-table-row"]')) {
      expect(row.classes()).toEqual([])
    }
  })

  it('[DTB-07] clickable の行を click すると row-click にその行が渡る', async () => {
    const wrapper = mount(DataTable, { props: { columns, rows, clickable: true } })

    const second = wrapper.findAll('[data-testid="data-table-row"]')[1]
    await second.find('td').trigger('click')

    expect(wrapper.emitted('row-click')).toEqual([[rows[1]]])
    expect(second.classes()).toContain('is-clickable')
    expect(second.attributes('tabindex')).toBe('0')
  })

  it('[DTB-08] clickable の行は行そのものの Enter でだけ row-click を出す', async () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows, clickable: true },
      slots: { 'cell-symbol': '<button type="button">内側</button>' },
    })

    const first = wrapper.find('[data-testid="data-table-row"]')
    await first.find('button').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('row-click')).toBeUndefined()

    await first.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('row-click')).toEqual([[rows[0]]])
  })

  it('[DTB-09] clickable を渡さないと click / Enter で row-click を出さない', async () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })

    const first = wrapper.find('[data-testid="data-table-row"]')
    await first.trigger('click')
    await first.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('row-click')).toBeUndefined()
    expect(first.attributes('tabindex')).toBeUndefined()
  })
})

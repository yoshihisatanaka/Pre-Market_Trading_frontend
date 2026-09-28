import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StalledOrderTable from './StalledOrderTable.vue'

/*
 * 表の列定義とセルの整形を見る。行はアプリ内モデル（src/api/stalledOrders.js の StalledOrder）で渡す。
 */
const BASE_ROW = {
  id: '27',
  branchCode: '234',
  accountNumber: '200001',
  customerName: '加藤 誠',
  symbol: 'MSFT',
  side: 'buy',
  quantity: 35,
  orderType: 'MO',
  limitPrice: null,
  marketCategoryName: 'レギュラー',
  orderedAt: '2026-09-16T10:22:00',
  statusName: '注文エラー',
  errorReason: '注文送信処理がタイムアウトしました。',
  confirmationNote: '',
}

const COMMON_HEADERS = [
  '注文ID',
  '部店',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '数量',
  '価格',
  '市場区分',
  '受注日時',
]

function mountTable(rows, variant = 'errors') {
  return mount(StalledOrderTable, { props: { rows, variant } })
}

const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
/** 見出しの名前で 1 行目のセルを引く */
const cell = (wrapper, label, rowIndex = 0) => {
  const index = headers(wrapper).indexOf(label)
  return wrapper.findAll('[data-testid="data-table-row"]')[rowIndex].findAll('td')[index].text()
}

// シナリオ: docs/unit/components-operations-stalled-order-table.md
describe('StalledOrderTable', () => {
  it('[SOT-01] errors の列見出しは 12 列で 11 列目がエラー理由', () => {
    const wrapper = mountTable([BASE_ROW], 'errors')

    expect(headers(wrapper)).toEqual([...COMMON_HEADERS, 'エラー理由', '出来状況'])
  })

  it('[SOT-02] working では 11 列目が確認状況になり confirmationNote が出る', () => {
    const note = '別システムのコンファメーション取込済み・未約定'
    const wrapper = mountTable([{ ...BASE_ROW, errorReason: '', confirmationNote: note }], 'working')

    expect(headers(wrapper)).toEqual([...COMMON_HEADERS, '確認状況', '出来状況'])
    expect(cell(wrapper, '確認状況')).toBe(note)
  })

  it('[SOT-03] 注文 ID は # を前置して出る', () => {
    const wrapper = mountTable([BASE_ROW])

    expect(cell(wrapper, '注文ID')).toBe(`#${BASE_ROW.id}`)
  })

  it('[SOT-04] 売買は buy が「買」、sell が「売」', () => {
    const wrapper = mountTable([BASE_ROW, { ...BASE_ROW, id: '26', side: 'sell' }])

    expect(cell(wrapper, '売買', 0)).toBe('買')
    expect(cell(wrapper, '売買', 1)).toBe('売')
  })

  it('[SOT-05] 売買が空なら「—」', () => {
    const wrapper = mountTable([{ ...BASE_ROW, side: '' }])

    expect(cell(wrapper, '売買')).toBe('—')
  })

  it('[SOT-06] 成行の価格は「成行」', () => {
    const wrapper = mountTable([BASE_ROW])

    expect(cell(wrapper, '価格')).toBe('成行')
  })

  it('[SOT-07] 指値の価格は「指値」と米ドル表記', () => {
    const LIMIT = 228.5
    const wrapper = mountTable([{ ...BASE_ROW, orderType: 'LO', limitPrice: LIMIT }])

    // 金額は全画面で単位を後置する（2026-09-28 決定。$ は前置しない）
    expect(cell(wrapper, '価格')).toBe(`指値 ${LIMIT.toFixed(2)} ドル`)
  })

  it('[SOT-08] 受注日時が空なら「—」', () => {
    const wrapper = mountTable([{ ...BASE_ROW, orderedAt: '' }])

    expect(cell(wrapper, '受注日時')).toBe('—')
  })

  it('[SOT-09] 顧客名や市場区分が空ならそのセルは「—」', () => {
    const wrapper = mountTable([{ ...BASE_ROW, customerName: '', marketCategoryName: '' }])

    expect(cell(wrapper, '顧客名')).toBe('—')
    expect(cell(wrapper, '市場区分')).toBe('—')
  })
})

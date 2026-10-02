import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { formatUsd } from '@/utils/format'
import { MARKET_SCOPE_OPTIONS } from '@/utils/orderTypes'
import OrderInquiryTable from './OrderInquiryTable.vue'

/*
 * 部品のテスト。props（groups / canOrder）→ 描画と emit の入出力だけを見る。
 * groups は src/api/orderInquiry.js の OrderInquiryGroup の形で組み立てる。
 */

/** 1 注文（OrderInquiryOrder）。行ごとに違う項目だけを overrides で差し替える */
const order = (overrides = {}) => ({
  id: '35',
  originalOrderId: '',
  branchCode: '345',
  accountNumber: '300002',
  customerName: '田中 正雄',
  symbol: 'TSLA',
  side: 'buy',
  quantity: 3000,
  canceledQuantity: null,
  orderType: 'MO',
  limitPrice: null,
  filledQuantity: 1200,
  remainingQuantity: 1800,
  filledAmountUsd: 406250,
  filledAmountJpy: 60937500,
  marketScope: '04',
  vwap: false,
  statusName: '一部出来',
  statusTone: 'partial',
  errorReason: '',
  orderedAt: '2026-09-28T09:01:00',
  amendable: true,
  cancelable: true,
  ...overrides,
})

const group = (latest, { history = [], slices = [] } = {}) => ({
  id: latest.id,
  latest,
  history,
  slices,
})

/** 訂正 2 回の元注文（#30 → #33 → #36） */
const amendedGroup = () =>
  group(order({ id: '36', originalOrderId: '30', symbol: 'NVDA' }), {
    history: [
      order({ id: '30', symbol: 'NVDA', statusTone: 'canceled', statusName: '取消済' }),
      order({ id: '33', originalOrderId: '30', symbol: 'NVDA', statusTone: 'canceled' }),
    ],
  })

/** 自動分割 3 件の元注文（#35 と子注文 #43〜#45） */
const splitGroup = () =>
  group(order({ id: '35' }), {
    slices: ['43', '44', '45'].map((id) => order({ id, originalOrderId: '35', quantity: 1000 })),
  })

const mountTable = (groups, props = {}) =>
  mount(OrderInquiryTable, { props: { groups, ...props } })

const headers = (wrapper) => wrapper.findAll('thead')[0].findAll('th').map((th) => th.text())
const rows = (wrapper) => wrapper.findAll('[data-testid="order-inquiry-row"]')
const historyRows = (wrapper) => wrapper.findAll('[data-testid="order-inquiry-history-row"]')
/** 行の中の、見出しが label の列のセル */
const cell = (wrapper, row, label) => row.findAll('td')[headers(wrapper).indexOf(label)]

// シナリオ: docs/unit/components-orders-order-inquiry-table.md
describe('OrderInquiryTable', () => {
  it('[OIT-01] 列見出しが画面モックの 18 列になる', () => {
    const wrapper = mountTable([group(order())])

    expect(headers(wrapper)).toEqual([
      '注文ID',
      '部店',
      '口座番号',
      '顧客名',
      '銘柄',
      '売買',
      '数量',
      '指値／成行',
      '価格',
      '出来数量',
      '未出来残数量',
      '約定代金（USD）',
      '約定代金（円貨）',
      '市場区分',
      '出来状況',
      '送信日時',
      '受注日時',
      '操作',
    ])
  })

  it('[OIT-02] 注文 ID は # 付きで、訂正履歴がある行にだけ「+」と訂正回数が出る', () => {
    const wrapper = mountTable([group(order({ id: '35' })), amendedGroup()])
    const [plain, amended] = rows(wrapper)

    expect(plain.text()).toContain('#35')
    expect(plain.find('[data-testid="order-inquiry-history-toggle"]').exists()).toBe(false)
    expect(plain.text()).not.toContain('訂正 ')

    expect(amended.find('[data-testid="order-inquiry-history-toggle"]').text()).toBe('+')
    expect(amended.text()).toContain('訂正 2回')
  })

  it('[OIT-03] 「+」で訂正履歴が開き、もう一度押すと閉じる', async () => {
    const wrapper = mountTable([amendedGroup()])
    const toggle = () => wrapper.find('[data-testid="order-inquiry-history-toggle"]')

    await toggle().trigger('click')
    expect(historyRows(wrapper)).toHaveLength(2)
    expect(toggle().text()).toBe('−')
    expect(toggle().attributes('aria-expanded')).toBe('true')

    await toggle().trigger('click')
    expect(historyRows(wrapper)).toHaveLength(0)
    expect(toggle().text()).toBe('+')
    expect(toggle().attributes('aria-expanded')).toBe('false')
  })

  it('[OIT-04] 訂正履歴の 1 行目は原注文、2 行目は第1回訂正と添えられる', async () => {
    const wrapper = mountTable([amendedGroup()])
    await wrapper.find('[data-testid="order-inquiry-history-toggle"]').trigger('click')
    const [original, first] = historyRows(wrapper)

    expect(cell(wrapper, original, '銘柄').text()).toContain('原注文（訂正済）')
    expect(cell(wrapper, first, '銘柄').text()).toContain('第1回訂正')
  })

  it('[OIT-05] 「自動分割 N件」で明細が開き、もう一度押すと閉じる', async () => {
    const wrapper = mountTable([splitGroup()])
    const toggle = () => wrapper.find('[data-testid="order-inquiry-split-toggle"]')
    const detail = () => wrapper.find('[data-testid="order-inquiry-split-detail"]')
    expect(toggle().text()).toBe('自動分割 3件')

    await toggle().trigger('click')
    const sliceRows = detail().find('tbody').findAll('tr')
    expect(sliceRows.map((tr) => tr.findAll('td')[0].text())).toEqual(['1 / 3', '2 / 3', '3 / 3'])
    expect(sliceRows.map((tr) => tr.findAll('td')[1].text())).toEqual(['#43', '#44', '#45'])
    expect(toggle().text()).toBe('自動分割を閉じる')

    await toggle().trigger('click')
    expect(detail().exists()).toBe(false)
    expect(toggle().text()).toBe('自動分割 3件')
  })

  it('[OIT-06] 明細の見出し 4 項目は「—」で出る', async () => {
    const wrapper = mountTable([splitGroup()])
    await wrapper.find('[data-testid="order-inquiry-split-toggle"]').trigger('click')
    const detail = wrapper.find('[data-testid="order-inquiry-split-detail"]')

    expect(detail.findAll('dt').map((dt) => dt.text())).toEqual([
      '適用上限',
      '適用理由',
      '5営業日平均出来高（取込値）',
      '参照価格',
    ])
    expect(detail.findAll('dd').map((dd) => dd.text())).toEqual(['—', '—', '—', '—'])
  })

  it('[OIT-07] 発注権限があれば可否に応じて訂正・取消が出て、押すと group を emit する', async () => {
    const both = group(order({ id: '1', amendable: true, cancelable: true }))
    const cancelOnly = group(order({ id: '2', amendable: false, cancelable: true }))
    const neither = group(order({ id: '3', amendable: false, cancelable: false }))
    const wrapper = mountTable([both, cancelOnly, neither], { canOrder: true })
    const [first, second, third] = rows(wrapper)
    const has = (row, testid) => row.find(`[data-testid="${testid}"]`).exists()

    expect([has(first, 'order-inquiry-amend'), has(first, 'order-inquiry-cancel')]).toEqual([true, true])
    expect([has(second, 'order-inquiry-amend'), has(second, 'order-inquiry-cancel')]).toEqual([false, true])
    expect([has(third, 'order-inquiry-amend'), has(third, 'order-inquiry-cancel')]).toEqual([false, false])
    expect(wrapper.find('[data-testid="order-inquiry-view-only"]').exists()).toBe(false)

    await first.find('[data-testid="order-inquiry-amend"]').trigger('click')
    await second.find('[data-testid="order-inquiry-cancel"]').trigger('click')

    expect(wrapper.emitted('amend')).toEqual([[both]])
    expect(wrapper.emitted('cancel')).toEqual([[cancelOnly]])
  })

  it('[OIT-08] 売買・指値／成行・価格が表示用の文言になる', () => {
    const LIMIT = 415
    const wrapper = mountTable([
      group(order({ id: '1', side: 'buy', orderType: 'LO', limitPrice: LIMIT })),
      group(order({ id: '2', side: 'sell', orderType: 'MO', limitPrice: null })),
      group(order({ id: '3', side: '', orderType: 'MO' })),
    ])
    const [buy, sell, unknown] = rows(wrapper)

    expect([buy, sell, unknown].map((row) => cell(wrapper, row, '売買').text())).toEqual([
      '買',
      '売',
      '—',
    ])
    expect(cell(wrapper, buy, '指値／成行').text()).toBe('指値')
    expect(cell(wrapper, sell, '指値／成行').text()).toBe('成行')
    expect(cell(wrapper, buy, '価格').text()).toBe(formatUsd(LIMIT))
    expect(cell(wrapper, buy, '価格').text()).toBe('415.00 ドル')
    expect(cell(wrapper, sell, '価格').text()).toBe('—')
  })

  it('[OIT-09] 出来 0 の出来数量・約定代金は「—」で、取消数量が数量の下に添えられる', () => {
    const wrapper = mountTable([
      group(
        order({
          quantity: 60,
          filledQuantity: 0,
          canceledQuantity: 40,
          filledAmountUsd: null,
          filledAmountJpy: null,
        }),
      ),
    ])
    const [row] = rows(wrapper)

    expect(cell(wrapper, row, '出来数量').text()).toBe('—')
    expect(cell(wrapper, row, '約定代金（USD）').text()).toBe('—')
    expect(cell(wrapper, row, '約定代金（円貨）').text()).toBe('—')
    expect(cell(wrapper, row, '数量').text()).toContain('取消 40')
  })

  it('[OIT-10] 注文エラーは is-error と理由の title、訂正履歴は is-muted になる', async () => {
    const REASON = '注文送信処理がタイムアウトしました。'
    const errorGroup = group(
      order({ id: '40', statusTone: 'error', statusName: '注文エラー', errorReason: REASON }),
    )
    const wrapper = mountTable([errorGroup, amendedGroup()])
    const status = cell(wrapper, rows(wrapper)[0], '出来状況').find('span')

    expect(status.classes()).toContain('is-error')
    expect(status.attributes('title')).toBe(REASON)

    await wrapper.find('[data-testid="order-inquiry-history-toggle"]').trigger('click')
    for (const historyRow of historyRows(wrapper)) {
      const historyStatus = cell(wrapper, historyRow, '出来状況').find('span')
      expect(historyStatus.classes()).toContain('is-muted')
      expect(historyStatus.classes()).not.toContain('is-canceled')
    }
  })

  it('[OIT-11] VWAP 注文は市場区分の下に VWAP と添えられる', () => {
    const wrapper = mountTable([group(order({ id: '1', vwap: true })), group(order({ id: '2' }))])
    const [vwap, plain] = rows(wrapper)

    expect(cell(wrapper, vwap, '市場区分').text()).toContain('VWAP')
    expect(cell(wrapper, plain, '市場区分').text()).not.toContain('VWAP')
  })

  it('[OIT-12] 送信日時は常に「—」', () => {
    const wrapper = mountTable([group(order({ id: '1' })), group(order({ id: '2' }))])

    for (const row of rows(wrapper)) {
      expect(cell(wrapper, row, '送信日時').text()).toBe('—')
    }
  })

  it('[OIT-13] 市場区分はコードではなく名前で出る', () => {
    const scope = MARKET_SCOPE_OPTIONS.find((option) => option.value === '04')
    const wrapper = mountTable([
      group(order({ id: '1', marketScope: scope.value })),
      group(order({ id: '2', marketScope: '99' })),
      group(order({ id: '3', marketScope: '' })),
    ])

    expect(rows(wrapper).map((row) => cell(wrapper, row, '市場区分').text())).toEqual([
      scope.label,
      '99',
      '—',
    ])
    expect(scope.label).toBe('プレ＋レギュラー＋アフター')
  })

  it('[OIT-14] 発注権限が無ければ「閲覧のみ」を出し、開閉は使える', async () => {
    const wrapper = mountTable([splitGroup(), amendedGroup()])

    expect(wrapper.findAll('[data-testid="order-inquiry-view-only"]')).toHaveLength(2)
    for (const row of rows(wrapper)) {
      expect(cell(wrapper, row, '操作').text()).toBe('閲覧のみ')
    }
    expect(wrapper.find('[data-testid="order-inquiry-amend"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="order-inquiry-cancel"]').exists()).toBe(false)

    await wrapper.find('[data-testid="order-inquiry-history-toggle"]').trigger('click')
    await wrapper.find('[data-testid="order-inquiry-split-toggle"]').trigger('click')
    expect(historyRows(wrapper)).toHaveLength(2)
    expect(wrapper.find('[data-testid="order-inquiry-split-detail"]').exists()).toBe(true)
  })

  const CUSTOMER_LABELS = ['部店', '口座番号', '顧客名']

  it('[OIT-15] 既定では部店・口座番号・顧客名の列が出る', () => {
    const latest = order()
    const wrapper = mountTable([group(latest)])
    const [row] = rows(wrapper)

    for (const label of CUSTOMER_LABELS) {
      expect(headers(wrapper)).toContain(label)
    }
    expect(cell(wrapper, row, '部店').text()).toBe(latest.branchCode)
    expect(cell(wrapper, row, '口座番号').text()).toBe(latest.accountNumber)
    expect(cell(wrapper, row, '顧客名').text()).toBe(latest.customerName)
  })

  it('[OIT-16] showCustomer が false なら顧客の 3 列が見出しとセルの両方から消える', async () => {
    const full = headers(mountTable([group(order())]))
    const wrapper = mountTable([amendedGroup()], { showCustomer: false })
    await wrapper.find('[data-testid="order-inquiry-history-toggle"]').trigger('click')

    expect(headers(wrapper)).toEqual(full.filter((label) => !CUSTOMER_LABELS.includes(label)))
    expect(headers(wrapper)).toHaveLength(full.length - CUSTOMER_LABELS.length)

    const latest = order()
    for (const row of [...rows(wrapper), ...historyRows(wrapper)]) {
      expect(row.findAll('td')).toHaveLength(headers(wrapper).length)
      const texts = row.findAll('td').map((td) => td.text())
      expect(texts).not.toContain(latest.branchCode)
      expect(texts).not.toContain(latest.accountNumber)
      expect(texts).not.toContain(latest.customerName)
    }
    expect(historyRows(wrapper)).toHaveLength(2)
  })

  it('[OIT-17] 自動分割の明細の colspan は列数に合う', async () => {
    for (const showCustomer of [false, true]) {
      const wrapper = mountTable([splitGroup()], { showCustomer })
      await wrapper.find('[data-testid="order-inquiry-split-toggle"]').trigger('click')

      const detailCell = wrapper.find('[data-testid="order-inquiry-split-detail"] > td')
      expect(detailCell.attributes('colspan'), String(showCustomer)).toBe(
        String(headers(wrapper).length),
      )
    }
  })
})

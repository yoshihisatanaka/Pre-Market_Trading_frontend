import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StalledOrderListCard from './StalledOrderListCard.vue'

/*
 * 4 状態の器。props と既定スロットの入出力だけを見る（滞留注文の中身は知らない）。
 */
const PREFIX = 'test-list'
const SLOT_TESTID = 'slot-body'
const EMPTY_MESSAGE = '対象はありません'

function mountCard(props = {}) {
  return mount(StalledOrderListCard, {
    props: {
      testidPrefix: PREFIX,
      title: '一覧',
      emptyMessage: EMPTY_MESSAGE,
      total: 0,
      loading: false,
      isEmpty: false,
      error: null,
      ...props,
    },
    slots: { default: `<div data-testid="${SLOT_TESTID}">表</div>` },
  })
}

const find = (wrapper, suffix) => wrapper.find(`[data-testid="${PREFIX}-${suffix}"]`)
const slotExists = (wrapper) => wrapper.find(`[data-testid="${SLOT_TESTID}"]`).exists()
const failure = { message: 'サーバーでエラーが発生しました。' }

// シナリオ: docs/unit/components-operations-stalled-order-list-card.md
describe('StalledOrderListCard', () => {
  it('[SOC-01] loading のときは読み込み中だけを出し、件数もスロットも描かない', () => {
    const wrapper = mountCard({ loading: true, total: 3 })

    expect(find(wrapper, 'loading').exists()).toBe(true)
    expect(find(wrapper, 'count').exists()).toBe(false)
    expect(slotExists(wrapper)).toBe(false)
  })

  it('[SOC-02] error があるとその message と「再試行」を出し、スロットは描かない', () => {
    const wrapper = mountCard({ error: failure })

    const error = find(wrapper, 'error')
    expect(error.text()).toContain(failure.message)
    expect(error.find('button').text()).toBe('再試行')
    expect(slotExists(wrapper)).toBe(false)
  })

  it('[SOC-03] 「再試行」を押すと reload が emit される', async () => {
    const wrapper = mountCard({ error: failure })

    await find(wrapper, 'error').find('button').trigger('click')

    expect(wrapper.emitted('reload')).toHaveLength(1)
  })

  it('[SOC-04] isEmpty のときは emptyMessage を出し、スロットは描かない', () => {
    const wrapper = mountCard({ isEmpty: true })

    expect(find(wrapper, 'empty').text()).toBe(EMPTY_MESSAGE)
    expect(slotExists(wrapper)).toBe(false)
  })

  it('[SOC-05] データありのときは既定スロットを描く', () => {
    const wrapper = mountCard({ total: 3 })

    expect(slotExists(wrapper)).toBe(true)
    expect(find(wrapper, 'loading').exists()).toBe(false)
    expect(find(wrapper, 'error').exists()).toBe(false)
    expect(find(wrapper, 'empty').exists()).toBe(false)
  })

  it('[SOC-06] loading でなければヘッダに件数を出す', () => {
    const TOTAL = 3
    const wrapper = mountCard({ total: TOTAL })

    expect(find(wrapper, 'count').text()).toBe(`${TOTAL} 件`)
  })

  it('[SOC-07] data-testid は testidPrefix を前置した名前になる', () => {
    const ids = (wrapper) =>
      wrapper.findAll('[data-testid]').map((el) => el.attributes('data-testid'))

    expect(ids(mountCard({ total: 1 }))).toContain(`${PREFIX}-count`)
    expect(ids(mountCard({ loading: true }))).toContain(`${PREFIX}-loading`)
    expect(ids(mountCard({ error: failure }))).toContain(`${PREFIX}-error`)
    expect(ids(mountCard({ isEmpty: true }))).toContain(`${PREFIX}-empty`)
  })
})

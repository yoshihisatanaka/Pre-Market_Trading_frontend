import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MasterListCard from './MasterListCard.vue'

const PREFIX = 'market-holidays'
const TITLE = '休場日一覧'
const EMPTY_MESSAGE = '該当する休場日はありません。'
const TOTAL = 120
const LIMIT = 50

/** 既定は「データあり」。4 状態は loading / error / isEmpty を上書きして作る */
function mountCard(props = {}, slots = {}) {
  return mount(MasterListCard, {
    props: {
      testidPrefix: PREFIX,
      title: TITLE,
      emptyMessage: EMPTY_MESSAGE,
      total: TOTAL,
      limit: LIMIT,
      offset: 0,
      loading: false,
      isEmpty: false,
      ...props,
    },
    slots,
  })
}

/** testid は prefix から組み立てる（文字列を直書きすると prefix の反映を検証できない） */
function testid(wrapper, suffix) {
  return wrapper.find(`[data-testid="${PREFIX}-${suffix}"]`)
}

const ROW_SLOT = { default: '<table data-testid="rows"></table>' }

// シナリオ: docs/unit/components-masters-master-list-card.md
describe('MasterListCard', () => {
  it('[MLC-01] testidPrefix を 4 状態と件数・ページャーの data-testid に反映する', () => {
    expect(testid(mountCard({ loading: true }), 'loading').exists()).toBe(true)
    expect(testid(mountCard({ error: new Error('取得に失敗しました') }), 'error').exists()).toBe(
      true,
    )
    expect(testid(mountCard({ isEmpty: true }), 'empty').exists()).toBe(true)

    const wrapper = mountCard({}, ROW_SLOT)
    expect(testid(wrapper, 'count').exists()).toBe(true)
    expect(testid(wrapper, 'pagination').exists()).toBe(true)
  })

  it('[MLC-02] title をカードのヘッダに出す', () => {
    const wrapper = mountCard({}, ROW_SLOT)

    expect(wrapper.text()).toContain(TITLE)
  })

  it('[MLC-03] 取得が終わっていれば件数を出す', () => {
    const wrapper = mountCard({}, ROW_SLOT)

    expect(testid(wrapper, 'count').text()).toBe(`${TOTAL} 件`)
  })

  it('[MLC-04] 取得中は件数を出さない', () => {
    const wrapper = mountCard({ loading: true })

    expect(testid(wrapper, 'count').exists()).toBe(false)
  })

  it('[MLC-05] loading のとき回転マークを出す', () => {
    const wrapper = mountCard({ loading: true })

    expect(testid(wrapper, 'loading').find('.base-spinner').exists()).toBe(true)
  })

  it('[MLC-06] loading と error が同時ならローディングだけを出す', () => {
    const wrapper = mountCard({ loading: true, error: new Error('取得に失敗しました') })

    expect(testid(wrapper, 'loading').exists()).toBe(true)
    expect(testid(wrapper, 'error').exists()).toBe(false)
  })

  it('[MLC-07] error のとき message と再試行ボタンを出す', () => {
    const error = new Error('取得に失敗しました')
    const wrapper = mountCard({ error })

    expect(testid(wrapper, 'error').text()).toContain(error.message)
    expect(testid(wrapper, 'error').find('button').text()).toBe('再試行')
  })

  it('[MLC-08] 再試行ボタンで reload を発火する', async () => {
    const wrapper = mountCard({ error: new Error('取得に失敗しました') })

    await testid(wrapper, 'error').find('button').trigger('click')

    expect(wrapper.emitted('reload')).toHaveLength(1)
  })

  it('[MLC-09] error と isEmpty が同時ならエラーだけを出す', () => {
    const wrapper = mountCard({ error: new Error('取得に失敗しました'), isEmpty: true })

    expect(testid(wrapper, 'error').exists()).toBe(true)
    expect(testid(wrapper, 'empty').exists()).toBe(false)
  })

  it('[MLC-10] 空のとき emptyMessage を出す', () => {
    const wrapper = mountCard({ isEmpty: true })

    expect(testid(wrapper, 'empty').text()).toBe(EMPTY_MESSAGE)
  })

  it('[MLC-11] データありのときスロットとページャーを出す', () => {
    const wrapper = mountCard({}, ROW_SLOT)

    expect(wrapper.find('[data-testid="rows"]').exists()).toBe(true)
    expect(testid(wrapper, 'pagination').exists()).toBe(true)
  })

  it('[MLC-12] ローディング / エラー / 空 ではスロットもページャーも出さない', () => {
    const states = [
      { loading: true },
      { error: new Error('取得に失敗しました') },
      { isEmpty: true },
    ]

    for (const state of states) {
      const wrapper = mountCard(state, ROW_SLOT)

      expect(wrapper.find('[data-testid="rows"]').exists()).toBe(false)
      expect(testid(wrapper, 'pagination').exists()).toBe(false)
    }
  })

  it('[MLC-13] ページャーのページ送りを update:offset で中継する', async () => {
    const wrapper = mountCard({}, ROW_SLOT)

    await testid(wrapper, 'pagination').find('[data-page="2"]').trigger('click')

    expect(wrapper.emitted('update:offset')).toEqual([[LIMIT]])
  })
})

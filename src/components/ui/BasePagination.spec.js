import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BasePagination from './BasePagination.vue'

/*
 * 汎用部品なので、休場日などのドメインには結び付けず数値リテラルで書く。
 * 件数表示の「–」は EN DASH(U+2013)。コンポーネントと 1 文字も違えないこと。
 */
const mountPagination = (props) =>
  mount(BasePagination, { props: { total: 56, limit: 50, offset: 0, ...props } })

const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)
const pageLabels = (wrapper) =>
  wrapper.findAll('[data-testid="pagination-page"]').map((button) => button.text())
const rangeText = (wrapper) => wrapper.find('[data-testid="pagination-range"]').text()
const prevButton = (wrapper) => wrapper.find('[data-testid="pagination-prev"]')
const nextButton = (wrapper) => wrapper.find('[data-testid="pagination-next"]')
const emittedOffsets = (wrapper) =>
  (wrapper.emitted('update:offset') ?? []).map(([offset]) => offset)

// シナリオ: docs/unit/components-ui-base-pagination.md
describe('BasePagination', () => {
  it('[BPG-01] 先頭ページでは件数とページ番号を出し「前へ」を無効にする', () => {
    const wrapper = mountPagination()

    expect(rangeText(wrapper)).toBe('56 件中 1–50 件')
    expect(pageLabels(wrapper)).toEqual(['1', '2'])
    expect(prevButton(wrapper).element.disabled).toBe(true)
  })

  it('[BPG-02] 最終ページでは端数の件数を出し「次へ」を無効にする', () => {
    const wrapper = mountPagination({ offset: 50 })

    expect(rangeText(wrapper)).toBe('56 件中 51–56 件')
    expect(nextButton(wrapper).element.disabled).toBe(true)
    expect(prevButton(wrapper).element.disabled).toBe(false)
  })

  it('[BPG-03] 0 件のときは件数だけを出す', () => {
    const wrapper = mountPagination({ total: 0 })

    expect(rangeText(wrapper)).toBe('0 件')
    expect(pageLabels(wrapper)).toEqual([])
  })

  it('[BPG-04] 1 ページに収まるときはページ送りのボタンを出さない', () => {
    const wrapper = mountPagination({ total: 10 })

    expect(prevButton(wrapper).exists()).toBe(false)
    expect(nextButton(wrapper).exists()).toBe(false)
    expect(pageLabels(wrapper)).toEqual([])
  })

  it('[BPG-05] ページ番号を click するとそのページ先頭の offset を emit する', async () => {
    const wrapper = mountPagination()

    await pageButton(wrapper, 2).trigger('click')

    expect(emittedOffsets(wrapper)).toEqual([50])
  })

  it('[BPG-06] 「次へ」で次のページの offset を emit する', async () => {
    const wrapper = mountPagination()

    await nextButton(wrapper).trigger('click')

    expect(emittedOffsets(wrapper)).toEqual([50])
  })

  it('[BPG-07] 「前へ」で前のページの offset を emit する', async () => {
    const wrapper = mountPagination({ offset: 50 })

    await prevButton(wrapper).trigger('click')

    expect(emittedOffsets(wrapper)).toEqual([0])
  })

  it('[BPG-08] 現在ページは強調され、click しても emit しない', async () => {
    const wrapper = mountPagination()
    const current = pageButton(wrapper, 1)

    expect(current.attributes('aria-current')).toBe('page')
    expect(current.classes()).toContain('base-button--primary')
    await current.trigger('click')

    expect(wrapper.emitted('update:offset')).toBeUndefined()
  })

  it('[BPG-09] disabled のときは全ボタンが無効で emit しない', async () => {
    const wrapper = mountPagination({ disabled: true })

    await pageButton(wrapper, 2).trigger('click')

    expect(pageButton(wrapper, 2).element.disabled).toBe(true)
    expect(prevButton(wrapper).element.disabled).toBe(true)
    expect(nextButton(wrapper).element.disabled).toBe(true)
    expect(wrapper.emitted('update:offset')).toBeUndefined()
  })

  it('[BPG-10] ページ数が多いときは離れたページを … に畳む', () => {
    const wrapper = mountPagination({ total: 1000, offset: 450 })

    expect(pageLabels(wrapper)).toEqual(['1', '9', '10', '11', '20'])
    expect(wrapper.findAll('.pagination__gap')).toHaveLength(2)
  })

  it('[BPG-11] 範囲外の offset は最終ページとして扱う', () => {
    const wrapper = mountPagination({ offset: 9999 })

    expect(rangeText(wrapper)).toBe('56 件中 51–56 件')
    expect(pageButton(wrapper, 2).attributes('aria-current')).toBe('page')
    expect(nextButton(wrapper).element.disabled).toBe(true)
  })
})

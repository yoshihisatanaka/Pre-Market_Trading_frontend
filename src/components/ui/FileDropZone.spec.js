import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FileDropZone from './FileDropZone.vue'

const csv = new File(['a,b,c'], 'orders.csv', { type: 'text/csv' })

// シナリオ: docs/unit/components-ui-file-drop-zone.md
describe('FileDropZone', () => {
  it('[FDZ-01] 未選択のときは案内文を出す', () => {
    const wrapper = mount(FileDropZone, { props: { modelValue: null } })

    expect(wrapper.text()).toContain('クリックまたはドラッグ＆ドロップでファイルを選択')
  })

  it('[FDZ-02] 選択済みのときはファイル名を出す', () => {
    const wrapper = mount(FileDropZone, { props: { modelValue: csv } })

    expect(wrapper.text()).toContain('orders.csv')
    expect(wrapper.text()).not.toContain('ドラッグ＆ドロップ')
  })

  it('[FDZ-03] ドロップされたファイルで update:modelValue が発火する', async () => {
    const wrapper = mount(FileDropZone, { props: { modelValue: null } })

    await wrapper.trigger('drop', { dataTransfer: { files: [csv] } })

    expect(wrapper.emitted('update:modelValue')).toEqual([[csv]])
  })

  it('[FDZ-04] ドラッグ中は data-dragover が true になる', async () => {
    const wrapper = mount(FileDropZone)

    await wrapper.trigger('dragover')

    expect(wrapper.attributes('data-dragover')).toBe('true')
  })

  it('[FDZ-05] 領域から離れると data-dragover が戻る', async () => {
    const wrapper = mount(FileDropZone)

    await wrapper.trigger('dragover')
    await wrapper.trigger('dragleave')

    expect(wrapper.attributes('data-dragover')).toBe('false')
  })

  it('[FDZ-06] accept をファイル入力に渡す', () => {
    const wrapper = mount(FileDropZone, { props: { accept: '.csv' } })

    expect(wrapper.find('input[type="file"]').attributes('accept')).toBe('.csv')
  })

  it('[FDZ-07] hint を補助文として出す', () => {
    const wrapper = mount(FileDropZone, { props: { hint: 'UTF-8 / Shift-JIS 対応' } })

    expect(wrapper.find('.drop-zone__hint').text()).toBe('UTF-8 / Shift-JIS 対応')
  })

  it('[FDZ-08] 選択後に modelValue を null に戻すと隠しの input の値が空に戻る', async () => {
    const wrapper = mount(FileDropZone, { props: { modelValue: csv } })
    const input = wrapper.find('input[type="file"]').element
    // jsdom の file input は value を観測しづらいので、setter に渡された値を記録する
    const assigned = []
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: (value) => {
        assigned.push(value)
      },
    })

    await wrapper.setProps({ modelValue: null })

    expect(assigned).toEqual([''])
  })

  it('[FDZ-09] icon スロットを aria-hidden のラッパに入れて案内文の前に出す', () => {
    const wrapper = mount(FileDropZone, {
      slots: { icon: '<svg data-testid="drop-icon" viewBox="0 0 24 24"></svg>' },
    })

    const wrap = wrapper.find('[aria-hidden="true"]')
    expect(wrap.exists()).toBe(true)
    expect(wrap.find('[data-testid="drop-icon"]').exists()).toBe(true)
    // 領域の最初の子がラッパで、そのあとに案内文が続く
    const children = wrapper.element.children
    expect(children[0]).toBe(wrap.element)
    expect(children[1].textContent).toBe('クリックまたはドラッグ＆ドロップでファイルを選択')
  })

  it('[FDZ-10] icon スロットを渡さなければラッパを描かない', () => {
    const wrapper = mount(FileDropZone)

    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(false)
    expect(wrapper.element.children[0].textContent).toBe(
      'クリックまたはドラッグ＆ドロップでファイルを選択',
    )
  })
})

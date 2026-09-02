import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FormGrid from './FormGrid.vue'

// シナリオ: docs/unit/components-ui-form-grid.md
describe('FormGrid', () => {
  it('[FGD-01] 既定は 4 列', () => {
    const wrapper = mount(FormGrid)

    expect(wrapper.classes()).toContain('form-grid--4')
  })

  it('[FGD-02] columns で列数を変えられる', () => {
    const wrapper = mount(FormGrid, { props: { columns: 2 } })

    expect(wrapper.classes()).toContain('form-grid--2')
  })

  it('[FGD-03] slot の中身をそのまま描画する', () => {
    const wrapper = mount(FormGrid, {
      slots: { default: '<span class="cell" /><span class="cell" /><span class="cell" />' },
    })

    expect(wrapper.findAll('.cell')).toHaveLength(3)
  })
})

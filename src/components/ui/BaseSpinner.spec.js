import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseSpinner from './BaseSpinner.vue'

// シナリオ: docs/unit/components-ui-base-spinner.md
describe('BaseSpinner', () => {
  it('[BSP-01] 既定は md で「読み込み中」を読み上げさせる', () => {
    const wrapper = mount(BaseSpinner)

    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.text()).toBe('読み込み中')
    // 目には見せない（クラスの実体は main.css のグローバル定義）
    expect(wrapper.find('.visually-hidden').exists()).toBe(true)
    expect(wrapper.classes()).toContain('base-spinner--md')
  })

  it('[BSP-02] size で大きさを変えられる', () => {
    const small = mount(BaseSpinner, { props: { size: 'sm' } })
    expect(small.classes()).toContain('base-spinner--sm')
    expect(small.classes()).not.toContain('base-spinner--md')

    // lg は画面全体を覆うとき用（AppLoadingOverlay と起動時のスプラッシュ）
    const large = mount(BaseSpinner, { props: { size: 'lg' } })
    expect(large.classes()).toContain('base-spinner--lg')
    expect(large.classes()).not.toContain('base-spinner--md')
  })

  it('[BSP-03] label で読み上げる文言を変えられる', () => {
    const wrapper = mount(BaseSpinner, { props: { label: '選択肢を読み込み中' } })

    expect(wrapper.text()).toBe('選択肢を読み込み中')
  })

  it('[BSP-04] label が空だと読み上げ対象から外れ、テキストを一切出さない', () => {
    const wrapper = mount(BaseSpinner, { props: { label: '' } })

    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    // ボタンの中で使うため。1 文字でも足すと「追加中…」の完全一致が壊れる
    expect(wrapper.text()).toBe('')
  })

  it('[BSP-05] ルートは span（<p> の中に置いても DOM が壊れない）', () => {
    const wrapper = mount(BaseSpinner)

    expect(wrapper.element.tagName).toBe('SPAN')
  })
})

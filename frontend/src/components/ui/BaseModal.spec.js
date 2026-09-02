import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseModal from './BaseModal.vue'

/*
 * Teleport で body に出るため、wrapper.find ではなく attachTo なしの document 検索を使う。
 * 検証しやすさのため teleport を stub し、wrapper 内に描画させる。
 */
function mountModal(props = {}, slots = {}) {
  return mount(BaseModal, {
    props: { open: true, ...props },
    slots,
    global: { stubs: { teleport: true } },
  })
}

// シナリオ: docs/unit/components-ui-base-modal.md
describe('BaseModal', () => {
  it('[BMD-01] open が false なら描画しない', () => {
    const wrapper = mountModal({ open: false })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('[BMD-02] title と slot をダイアログの中に描画する', () => {
    const wrapper = mountModal({ title: '削除確認' }, { default: '<p>本当に削除しますか？</p>' })

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain('削除確認')
    expect(dialog.text()).toContain('本当に削除しますか？')
  })

  it('[BMD-03] 幕をクリックすると close を発火する', async () => {
    const wrapper = mountModal()

    await wrapper.find('.modal').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[BMD-04] ダイアログ本体のクリックでは close しない', async () => {
    const wrapper = mountModal()

    await wrapper.find('[role="dialog"]').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('[BMD-05] Esc キーで close を発火する', async () => {
    const wrapper = mountModal()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[BMD-06] 閉じているときは Esc キーで close しない', () => {
    const wrapper = mountModal({ open: false })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('[BMD-07] footer スロットをフッタ行に描画する', () => {
    const wrapper = mountModal({}, { footer: '<button>キャンセル</button>' })

    expect(wrapper.find('.modal__footer').text()).toBe('キャンセル')
  })

  it('[BMD-08] size="sm" で幅の狭い箱になる', () => {
    const wrapper = mountModal({ size: 'sm' })

    expect(wrapper.find('[role="dialog"]').classes()).toContain('modal__box--sm')
  })
})

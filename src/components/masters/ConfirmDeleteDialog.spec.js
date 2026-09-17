import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue'

const PREFIX = 'market-holidays'
const LABEL = '2026-01-01'

/*
 * BaseModal の Teleport で body に出るため、teleport を stub して wrapper 内に描画させる
 * （見本: src/components/ui/BaseModal.spec.js の mountModal）。
 */
function mountDialog(props = {}) {
  return mount(ConfirmDeleteDialog, {
    props: { open: true, testidPrefix: PREFIX, label: LABEL, ...props },
    global: { stubs: { teleport: true } },
  })
}

/** testid は prefix から組み立てる（文字列を直書きすると prefix の反映を検証できない） */
function testid(wrapper, suffix) {
  return wrapper.find(`[data-testid="${PREFIX}-${suffix}"]`)
}

/** 本文は要素をまたいで 1 文になるので、改行と字下げを潰してから照合する */
function dialogText(wrapper) {
  return wrapper.find('[role="dialog"]').text().replace(/\s+/g, ' ')
}

// シナリオ: docs/unit/components-masters-confirm-delete-dialog.md
describe('ConfirmDeleteDialog', () => {
  it('[CDD-01] open が false なら描画しない', () => {
    const wrapper = mountDialog({ open: false })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('[CDD-02] タイトルを「削除確認」にする', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('[role="dialog"]').text()).toContain('削除確認')
  })

  it('[CDD-03] label を含む確認文を出す', () => {
    const wrapper = mountDialog()

    expect(dialogText(wrapper)).toContain(`${LABEL} を削除しますか？`)
  })

  it('[CDD-04] 元に戻せない旨の注意書きを出す', () => {
    const wrapper = mountDialog()

    expect(dialogText(wrapper)).toContain('この操作は元に戻せません。')
  })

  it('[CDD-05] testidPrefix を 2 つのボタンの data-testid に反映する', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'delete-cancel').exists()).toBe(true)
    expect(testid(wrapper, 'delete-submit').exists()).toBe(true)
  })

  it('[CDD-06] error をダイアログの中に出す', () => {
    const error = new Error('削除に失敗しました')
    const wrapper = mountDialog({ error })

    expect(testid(wrapper, 'delete-error').text()).toBe(error.message)
  })

  it('[CDD-07] error を渡さなければエラー枠は出ない', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'delete-error').exists()).toBe(false)
  })

  it('[CDD-08] pending でなければ「削除する」で両ボタンとも押せる', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'delete-submit').text()).toBe('削除する')
    expect(testid(wrapper, 'delete-submit').attributes('disabled')).toBeUndefined()
    expect(testid(wrapper, 'delete-cancel').attributes('disabled')).toBeUndefined()
  })

  it('[CDD-09] pending 中は「削除中…」になる', () => {
    const wrapper = mountDialog({ pending: true })

    expect(testid(wrapper, 'delete-submit').text()).toBe('削除中…')
  })

  it('[CDD-10] pending 中はキャンセルも削除も押せない', () => {
    const wrapper = mountDialog({ pending: true })

    expect(testid(wrapper, 'delete-cancel').attributes('disabled')).toBeDefined()
    expect(testid(wrapper, 'delete-submit').attributes('disabled')).toBeDefined()
  })

  it('[CDD-11] 削除ボタンで confirm を発火する', async () => {
    const wrapper = mountDialog()

    await testid(wrapper, 'delete-submit').trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('[CDD-12] キャンセルボタンで close を発火する', async () => {
    const wrapper = mountDialog()

    await testid(wrapper, 'delete-cancel').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('[CDD-13] 削除ボタンを危険色にする', () => {
    const wrapper = mountDialog()

    expect(testid(wrapper, 'delete-submit').classes()).toContain('base-button--danger')
  })
})

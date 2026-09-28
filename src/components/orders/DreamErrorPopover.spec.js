import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { dreamOrders } from '@/mocks/fixtures/dreamStatus'
import DreamErrorPopover from './DreamErrorPopover.vue'

/*
 * 本文は body へ Teleport するので、teleport を stub して wrapper 内に描画させる。
 * 本文は閉じていても DOM に残る（v-show）ので、表示の有無は display で見る。
 * jsdom は寸法を持たないので、位置のテストではトリガの矩形と本文の寸法を与える。
 */

const TITLE = 'Dream登録エラー詳細'
const MESSAGE = dreamOrders.find((row) => row.Dreamエラー内容).Dreamエラー内容
const SLOT_TEXT = '登録失敗'
const FALLBACK = 'エラー内容を確認してください。'
/** トリガとポップアップの間隔・画面端との余白（部品の既定） */
const GAP = 8

const mounted = []

afterEach(() => {
  // 開いたままのポップアップが window に残したリスナを外す
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
})

function mountPopover(props = {}) {
  const wrapper = mount(DreamErrorPopover, {
    props: { title: TITLE, message: MESSAGE, ...props },
    slots: { default: `<span>${SLOT_TEXT}</span>` },
    global: { stubs: { teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

const triggerOf = (wrapper) => wrapper.find('[data-testid="dream-status-error-trigger"]')
const popoverOf = (wrapper) => wrapper.find('[data-testid="dream-status-error-popover"]')
const isShown = (wrapper) => popoverOf(wrapper).element.style.display !== 'none'

/** 開く（表示後に寸法を測ってから位置を決めるので、nextTick の先まで待つ） */
async function open(wrapper) {
  await triggerOf(wrapper).trigger('mouseenter')
  await flushPromises()
}

/**
 * トリガの矩形と本文の寸法を与える。
 * 本文の寸法は要素ではなく prototype の getter で与える（teleport の stub 下では、開く前に
 * 取った本文の要素と、開いたあとに部品が測る要素が同一とは限らない）。
 * この部品で寸法を読むのは本文だけなので、prototype に当てても測り間違えない。
 */
function layout(wrapper, { top, bottom, left }, { width = 300, height = 80 } = {}) {
  triggerOf(wrapper).element.getBoundingClientRect = () => ({
    top,
    bottom,
    left,
    right: left + 60,
    width: 60,
    height: bottom - top,
    x: left,
    y: top,
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(height)
}

// シナリオ: docs/unit/components-orders-dream-error-popover.md
describe('DreamErrorPopover', () => {
  it('[DEP-01] スロットをトリガに出し、本文は閉じたまま aria-describedby で参照される', () => {
    const wrapper = mountPopover()

    const trigger = triggerOf(wrapper)
    const popover = popoverOf(wrapper)
    expect(trigger.text()).toContain(SLOT_TEXT)
    expect(trigger.attributes('tabindex')).toBe('0')
    expect(popover.attributes('role')).toBe('tooltip')
    expect(popover.attributes('id')).toBeTruthy()
    expect(trigger.attributes('aria-describedby')).toBe(popover.attributes('id'))
    expect(isShown(wrapper)).toBe(false)
  })

  it('[DEP-02] マウスを乗せると見出しとエラー内容が表示される', async () => {
    const wrapper = mountPopover()

    await open(wrapper)

    expect(isShown(wrapper)).toBe(true)
    const popover = popoverOf(wrapper)
    expect(popover.element.firstElementChild.textContent).toBe(TITLE)
    expect(popover.text()).toContain(MESSAGE)
  })

  it('[DEP-03] マウスが離れると非表示に戻る', async () => {
    const wrapper = mountPopover()
    await open(wrapper)

    await triggerOf(wrapper).trigger('mouseleave')

    expect(isShown(wrapper)).toBe(false)
  })

  it('[DEP-04] フォーカスで表示され、フォーカスが外れると非表示に戻る', async () => {
    const wrapper = mountPopover()

    await triggerOf(wrapper).trigger('focus')
    await flushPromises()
    expect(isShown(wrapper)).toBe(true)

    await triggerOf(wrapper).trigger('blur')
    expect(isShown(wrapper)).toBe(false)
  })

  it('[DEP-05] Esc キーで閉じる', async () => {
    const wrapper = mountPopover()
    await triggerOf(wrapper).trigger('focus')
    await flushPromises()

    await triggerOf(wrapper).trigger('keydown', { key: 'Escape' })

    expect(isShown(wrapper)).toBe(false)
  })

  it('[DEP-06] エラー内容が空なら定型文を出す', async () => {
    const wrapper = mountPopover({ message: '' })

    await open(wrapper)

    expect(popoverOf(wrapper).text()).toContain(FALLBACK)
  })

  it('[DEP-07] 開いている間にスクロール・リサイズが起きると閉じる', async () => {
    const wrapper = mountPopover()

    for (const type of ['scroll', 'resize']) {
      await open(wrapper)
      expect(isShown(wrapper)).toBe(true)

      window.dispatchEvent(new Event(type))
      await flushPromises()

      expect(isShown(wrapper)).toBe(false)
    }
  })

  it('[DEP-08] 上に余白があればトリガの真上に置く', async () => {
    const rect = { top: 200, bottom: 220, left: 100 }
    const size = { width: 300, height: 80 }
    const wrapper = mountPopover()
    layout(wrapper, rect, size)

    await open(wrapper)

    const popover = popoverOf(wrapper)
    expect(popover.element.style.top).toBe(`${rect.top - GAP - size.height}px`)
    expect(popover.element.style.left).toBe(`${rect.left}px`)
    expect(popover.classes()).toContain('is-top')
  })

  it('[DEP-09] 上に入らなければトリガの真下に置く', async () => {
    const size = { width: 300, height: 80 }
    // 上端からの距離が本文の高さ + 間隔より小さい
    const rect = { top: size.height - 10, bottom: size.height + 10, left: 100 }
    const wrapper = mountPopover()
    layout(wrapper, rect, size)

    await open(wrapper)

    const popover = popoverOf(wrapper)
    expect(popover.element.style.top).toBe(`${rect.bottom + GAP}px`)
    expect(popover.classes()).toContain('is-bottom')
  })

  it('[DEP-10] 右端では画面の内側へ押し戻す', async () => {
    const size = { width: 300, height: 80 }
    const rect = { top: 200, bottom: 220, left: window.innerWidth - 50 }
    const wrapper = mountPopover()
    layout(wrapper, rect, size)

    await open(wrapper)

    expect(popoverOf(wrapper).element.style.left).toBe(
      `${window.innerWidth - size.width - GAP}px`,
    )
  })
})

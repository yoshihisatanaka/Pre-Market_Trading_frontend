import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIDEBAR_BREAKPOINT, useSidebarToggle } from './useSidebarToggle'

/*
 * window.innerWidth は jsdom では getter しか無く、ESM は strict なので代入すると
 * TypeError になる。差し替えは vi.stubGlobal を使う。
 */
const STORAGE_KEY = 'app.sidebar.open'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('innerWidth', 1280)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// シナリオ: docs/unit/composables-use-sidebar-toggle.md
describe('useSidebarToggle', () => {
  it('[UST-01] 保存値が無く画面が広いときは開いた状態で始まる', () => {
    const { isOpen } = useSidebarToggle()

    expect(isOpen.value).toBe(true)
  })

  it('[UST-02] 保存値が無くブレークポイント以下の幅では閉じた状態で始まる', () => {
    vi.stubGlobal('innerWidth', SIDEBAR_BREAKPOINT)

    const { isOpen } = useSidebarToggle()

    expect(isOpen.value).toBe(false)
  })

  it('[UST-03] 保存値「閉」は画面幅より優先される', () => {
    localStorage.setItem(STORAGE_KEY, 'false')

    const { isOpen } = useSidebarToggle()

    expect(isOpen.value).toBe(false)
  })

  it('[UST-04] 保存値「開」は狭い画面でも優先される', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    vi.stubGlobal('innerWidth', 800)

    const { isOpen } = useSidebarToggle()

    expect(isOpen.value).toBe(true)
  })

  it('[UST-05] toggle するたびに反転し、その都度保存される', () => {
    const { isOpen, toggle } = useSidebarToggle()

    toggle()
    expect(isOpen.value).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')

    toggle()
    expect(isOpen.value).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('[UST-06] 壊れた保存値は無視して画面幅による既定で始まる', () => {
    localStorage.setItem(STORAGE_KEY, 'yes')
    vi.stubGlobal('innerWidth', 800)

    const { isOpen } = useSidebarToggle()

    expect(isOpen.value).toBe(false)
  })

  it('[UST-07] localStorage が使えなくても例外を投げずに開閉できる', () => {
    const denied = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)

    const { isOpen, toggle } = useSidebarToggle()

    expect(isOpen.value).toBe(true)
    expect(() => toggle()).not.toThrow()
    expect(isOpen.value).toBe(false)
  })
})

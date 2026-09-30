import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob, downloadCsv } from './download'

/*
 * jsdom は URL.createObjectURL / revokeObjectURL を持たないので、テストの間だけ生やす。
 * <a> の click は既定動作（遷移）を jsdom が実装していないので、spy に差し替えて
 * click された瞬間の要素の様子を記録する。
 */
const OBJECT_URL = 'blob:http://localhost/test'
const FILENAME = 'test.csv'
const TEXT = 'a,b\r\n1,2\r\n'

let created = []
let clicked = []

beforeEach(() => {
  /*
   * 破棄は setTimeout で次のタスクに回るので、全テストで fake timers にする。
   * 実タイマーのままだと、afterEach で stub を外したあとに破棄が走って例外になる。
   */
  vi.useFakeTimers()
  created = []
  clicked = []
  URL.createObjectURL = vi.fn((blob) => {
    created.push(blob)
    return OBJECT_URL
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
    clicked.push({
      element: this,
      download: this.getAttribute('download'),
      href: this.getAttribute('href'),
      connected: this.isConnected,
    })
  })
})

afterEach(() => {
  // 残った破棄を stub があるうちに流してから外す
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
  delete URL.createObjectURL
  delete URL.revokeObjectURL
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** jsdom の Blob を文字列で読む */
const readBlob = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })

// シナリオ: docs/unit/utils-download.md
describe('utils/download', () => {
  it('[DLU-01] download 属性にファイル名を持つリンクが click される', () => {
    downloadCsv(FILENAME, TEXT)

    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe(FILENAME)
    expect(clicked[0].href).toBe(OBJECT_URL)
    // click の時点では文書に置かれている（置かないと click を受け付けないブラウザがある）
    expect(clicked[0].connected).toBe(true)
  })

  it('[DLU-02] 本文は text/csv;charset=utf-8 の Blob になる', async () => {
    // FileReader の読み出しはタイマーに乗るので、このテストだけ実タイマーで動かす
    vi.useRealTimers()

    downloadCsv(FILENAME, TEXT)

    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('text/csv;charset=utf-8')
    expect(await readBlob(created[0])).toBe(TEXT)
    // 次のタスクの破棄を stub が残っているうちに済ませる
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('[DLU-03] click のあとリンクは文書から外れる', () => {
    downloadCsv(FILENAME, TEXT)

    expect(clicked[0].element.isConnected).toBe(false)
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  it('[DLU-04] オブジェクト URL は次のタスクで破棄される', () => {
    downloadCsv(FILENAME, TEXT)

    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
  })

  it('[DLU-05] downloadBlob は渡した Blob をそのままファイル名付きで click させる', () => {
    const blob = new Blob([TEXT], { type: 'text/csv' })

    downloadBlob(FILENAME, blob)

    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe(FILENAME)
    expect(clicked[0].href).toBe(OBJECT_URL)
    // 作り直さない（BOM などの中身に触らない）
    expect(created).toHaveLength(1)
    expect(created[0]).toBe(blob)
  })

  it('[DLU-06] downloadBlob のあとリンクは外れ、オブジェクト URL は次のタスクで破棄される', () => {
    downloadBlob(FILENAME, new Blob([TEXT]))

    expect(clicked[0].element.isConnected).toBe(false)
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
  })
})

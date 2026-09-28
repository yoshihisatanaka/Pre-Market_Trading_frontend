/**
 * 手元で組み立てた CSV をファイルとしてダウンロードさせる。
 *
 * DOM の副作用だけの関数で、状態は持たない。HTTP は使わない（サーバから落とすファイルではない）。
 * jsdom は `URL.createObjectURL` を持たないので、画面の単体テストはこのモジュールを
 * `vi.mock` して「何を渡したか」を見る（中身の書式は utils/csv.js 側のテストが持つ）。
 *
 * @param {string} filename 保存するときのファイル名
 * @param {string} text CSV の本文（BOM を付けるのは utils/csv.js の責務）
 */
export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()

  // click の中で即座に破棄すると、ダウンロードの開始前に URL が消える環境がある。次のタスクまで待つ
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

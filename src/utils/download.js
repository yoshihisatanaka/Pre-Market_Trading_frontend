/**
 * ファイルをダウンロードさせる。
 *
 * DOM の副作用だけの関数で、状態は持たない。HTTP は使わない（サーバから受け取った本文は
 * api 層が Blob にして渡す。手元で組み立てた CSV は downloadCsv に文字列で渡す）。
 * jsdom は `URL.createObjectURL` を持たないので、画面の単体テストはこのモジュールを
 * `vi.mock` して「何を渡したか」を見る（中身の書式は utils/csv.js 側のテストが持つ）。
 */

/**
 * Blob をそのままファイルとして保存させる（サーバが返した xlsx など）。
 *
 * @param {string} filename 保存するときのファイル名
 * @param {Blob} blob 中身（type も含めて手を加えない）
 */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()

  // click の中で即座に破棄すると、ダウンロードの開始前に URL が消える環境がある。次のタスクまで待つ
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * 手元で組み立てた CSV をファイルとしてダウンロードさせる。
 *
 * @param {string} filename 保存するときのファイル名
 * @param {string} text CSV の本文（BOM を付けるのは utils/csv.js の責務）
 */
export function downloadCsv(filename, text) {
  downloadBlob(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }))
}

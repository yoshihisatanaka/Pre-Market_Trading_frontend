/*
 * ファイルをダウンロードさせる（DOM の副作用だけの関数で、状態は持たない。HTTP は使わない）。
 * jsdom は `URL.createObjectURL` を持たないので、画面の単体テストはこのモジュールを
 * `vi.mock` して「何を渡したか」を見る（中身の書式は utils/csv.js 側のテストが持つ）。
 */

/**
 * 手元で組み立てた CSV をファイルとしてダウンロードさせる。
 *
 * @param {string} filename 保存するときのファイル名
 * @param {string} text CSV の本文（BOM を付けるのは utils/csv.js の責務）
 */
export function downloadCsv(filename, text) {
  downloadBlob(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }))
}

/**
 * Blob をファイルとしてダウンロードさせる。サーバから受け取ったファイルはこちらに渡す
 * （本文を文字列に読み直すと UTF-8 の BOM が落ちるので、受け取った Blob をそのまま使う）。
 *
 * @param {string} filename 保存するときのファイル名
 * @param {Blob} blob ファイルの中身
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

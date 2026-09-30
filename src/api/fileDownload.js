/*
 * サーバが返すファイル（xlsx など）の応答を、画面が落とせる形 `{ blob, filename }` にする。
 *
 * HTTP の形（ヘッダ名・Content-Disposition の書式）を知ってよいのは api 層だけなので、ここに置く。
 * 要求は `responseType: 'arraybuffer'` で出す（理由は client.js の decodeBinaryBody）。
 *
 * ヘッダが読めるのは同一オリジン（Vite のプロキシ経由）のとき。別オリジンに向けると
 * Access-Control-Expose-Headers が無い限り読めないので、そのときは呼び出し側の既定名に落ちる。
 */

/**
 * @typedef {{ blob: Blob, filename: string }} FileDownload
 */

/**
 * axios の応答（本文は ArrayBuffer）→ FileDownload。
 *
 * @param {{ data: ArrayBuffer, headers: Record<string, string|undefined> }} response
 * @param {string} fallbackFilename Content-Disposition からファイル名が取れないときの名前
 * @returns {FileDownload}
 */
export function toFileDownload(response, fallbackFilename) {
  const type = response.headers?.['content-type'] ?? ''

  return {
    blob: new Blob([response.data], type ? { type } : {}),
    filename: parseFilename(response.headers?.['content-disposition']) || fallbackFilename,
  }
}

/**
 * Content-Disposition からファイル名を取り出す。
 *
 * 日本語のファイル名は RFC 5987 の `filename*=UTF-8''<百分率符号化>` で届く
 * （実 API のオーダーシート）。ASCII だけの名前は `filename=executions.csv` / `filename="…"`。
 * 両方あれば `filename*` を採る（RFC 6266 の優先順）。
 *
 * @param {string|undefined} header
 * @returns {string} 取り出せなければ空文字
 */
function parseFilename(header) {
  if (typeof header !== 'string') return ''

  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      // 符号化が壊れていたら filename= の方を見る
    }
  }

  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header)
  return (plain?.[1] ?? plain?.[2] ?? '').trim()
}

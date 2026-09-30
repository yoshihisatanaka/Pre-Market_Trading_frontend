import { describe, expect, it } from 'vitest'
import { toFileDownload } from './fileDownload'

/*
 * ファイル応答の変換のテスト。HTTP は通さず、axios の応答の形（data / headers）を直接渡す。
 * axios はヘッダ名を小文字で持つので、ここでも小文字で書く。
 */
const FALLBACK = '既定名.xlsx'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 応答の形のオブジェクト。本文は 4 バイトの ArrayBuffer */
function response(headers = {}) {
  return { data: new Uint8Array([1, 2, 3, 4]).buffer, headers }
}

// シナリオ: docs/unit/api-file-download.md
describe('api/fileDownload', () => {
  it('[FDL-01] filename* の百分率符号化を復号して日本語のファイル名にする', () => {
    const name = 'オーダーシート_20260928_BUY_US.xlsx'
    const header = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`

    expect(toFileDownload(response({ 'content-disposition': header }), FALLBACK).filename).toBe(
      name,
    )
  })

  it('[FDL-02] filename= は引用符の有無どちらでも取り出す', () => {
    const plain = response({ 'content-disposition': 'attachment; filename=executions.csv' })
    const quoted = response({ 'content-disposition': 'attachment; filename="a b.csv"' })

    expect(toFileDownload(plain, FALLBACK).filename).toBe('executions.csv')
    expect(toFileDownload(quoted, FALLBACK).filename).toBe('a b.csv')
  })

  it('[FDL-03] filename* と filename の両方があれば filename* を採る', () => {
    const header = `attachment; filename="fallback.xlsx"; filename*=UTF-8''${encodeURIComponent('注文.xlsx')}`

    expect(toFileDownload(response({ 'content-disposition': header }), FALLBACK).filename).toBe(
      '注文.xlsx',
    )
  })

  it('[FDL-04] Content-Disposition が無ければ既定名を使う', () => {
    expect(toFileDownload(response(), FALLBACK).filename).toBe(FALLBACK)
  })

  it('[FDL-05] 本文は Content-Type を type に持つ Blob になる', () => {
    const { blob } = toFileDownload(response({ 'content-type': XLSX }), FALLBACK)

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe(XLSX)
    expect(blob.size).toBe(4)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { branches, codeMasters } from '@/mocks/fixtures/codes'
import { fetchCodes } from './codes'

/*
 * API 層のテスト。全画面のプルダウンの選択肢がここから出るので、
 * 「選択肢の形が壊れないこと」と「壊れた応答でも落ちないこと」を固定する。
 *
 * シナリオ: docs/unit/api-codes.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get('*/api/codes', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

// 期待値の材料はフィクスチャから取る（'部店' の中身を直接書かない）
const BRANCH_KEY = '部店'
const branchSource = codeMasters[BRANCH_KEY]

describe('api/codes', () => {
  it('[CDA-01] コードマスタの取得はクエリを持たない', async () => {
    record({})

    await fetchCodes()

    expect(lastRequest.url.pathname).toBe('/api/codes')
    // 実 API は絞り込みのクエリを持たず、常に全部返す
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[CDA-02] code / label を value / label に直す', async () => {
    record({ [BRANCH_KEY]: branchSource })

    const codes = await fetchCodes()

    expect(Object.keys(codes)).toEqual([BRANCH_KEY])
    expect(codes[BRANCH_KEY]).toEqual(
      branchSource.map(({ code, label }) => ({ value: code, label })),
    )
  })

  it('[CDA-03] 数値のコードも文字列の value になる', async () => {
    record({ [BRANCH_KEY]: [{ code: Number(branches[0].code), label: branches[0].name }] })

    const codes = await fetchCodes()

    expect(codes[BRANCH_KEY][0].value).toBe(branches[0].code)
    expect(typeof codes[BRANCH_KEY][0].value).toBe('string')
  })

  it('[CDA-04] フロントの知らないコードマスタ名もそのまま通す', async () => {
    const unknownKey = 'まだ知らない区分'
    record({ [unknownKey]: [{ code: '9', label: '未知' }] })

    const codes = await fetchCodes()

    expect(codes[unknownKey]).toEqual([{ value: '9', label: '未知' }])
  })

  it('[CDA-05] 配列でない値は空配列に寄せる', async () => {
    record({ 壊れた区分: null, 別の壊れ方: { code: '1' }, 文字列: 'x' })

    const codes = await fetchCodes()

    expect(codes).toEqual({ 壊れた区分: [], 別の壊れ方: [], 文字列: [] })
  })

  it('[CDA-06] 空の応答は空の辞書になる', async () => {
    record({})

    const codes = await fetchCodes()

    expect(codes).toEqual({})
  })

  it('[CDA-07] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchCodes()).rejects.toBeTruthy()
  })
})

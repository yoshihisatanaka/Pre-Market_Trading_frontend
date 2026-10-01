import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  branchListResponse,
  codeMasters,
  handlerListResponse,
} from '@/mocks/fixtures/codes'
import { fetchBranches, fetchCodes, fetchHandlers } from './codes'

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
 * @param {string} path '/codes' など
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(path, body, status = 200) {
  server.use(
    http.get(`*/api${path}`, ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

// 期待値の材料はフィクスチャから取る（'口座区分' の中身を直接書かない）
const ACCOUNT_KEY = '口座区分'
const accountSource = codeMasters[ACCOUNT_KEY]

describe('api/codes', () => {
  it('[CDA-01] コードマスタの取得はクエリを持たない', async () => {
    record('/codes', {})

    await fetchCodes()

    expect(lastRequest.url.pathname).toBe('/api/codes')
    // 実 API は絞り込みのクエリを持たず、常に全部返す
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[CDA-02] {コード: 名称} を value / label の配列に直す', async () => {
    record('/codes', { [ACCOUNT_KEY]: accountSource })

    const codes = await fetchCodes()

    expect(Object.keys(codes)).toEqual([ACCOUNT_KEY])
    expect(codes[ACCOUNT_KEY]).toEqual(
      Object.entries(accountSource).map(([value, label]) => ({ value, label })),
    )
  })

  it('[CDA-03] 選択肢はコードの文字列順に並ぶ（整数に見えるキーが先に来ない）', async () => {
    // JSON.parse は '101' を '000' より前に並べる。実 API の 処理状況 がこの形
    record('/codes', { 処理状況: { '000': '未発注', 101: 'Dream発注失敗', '040': '訂正待ち' } })

    const codes = await fetchCodes()

    expect(codes.処理状況.map((option) => option.value)).toEqual(['000', '040', '101'])
  })

  it('[CDA-04] フロントの知らないカテゴリもそのまま通す', async () => {
    const unknownKey = 'まだ知らない区分'
    record('/codes', { [unknownKey]: { 9: '未知' } })

    const codes = await fetchCodes()

    expect(codes[unknownKey]).toEqual([{ value: '9', label: '未知' }])
  })

  it('[CDA-05] object でない値は空配列に寄せ、名称が文字列でない行は捨てる', async () => {
    record('/codes', { 壊れた区分: null, 配列: [{ code: '1' }], 文字列: 'x', 混在: { 1: 'A', 2: 3 } })

    const codes = await fetchCodes()

    expect(codes).toEqual({
      壊れた区分: [],
      配列: [],
      文字列: [],
      混在: [{ value: '1', label: 'A' }],
    })
  })

  it('[CDA-06] 空の応答は空の辞書になる', async () => {
    record('/codes', {})

    const codes = await fetchCodes()

    expect(codes).toEqual({})
  })

  it('[CDA-07] サーバエラーは例外になる', async () => {
    record('/codes', { detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchCodes()).rejects.toBeTruthy()
  })

  it('[CDA-08] 2 段のカテゴリ（投資方針）は 1 段目のコードごとの選択肢になる', async () => {
    record('/codes', { 投資方針: codeMasters.投資方針 })

    const codes = await fetchCodes()

    expect(Object.keys(codes.投資方針).sort()).toEqual(Object.keys(codeMasters.投資方針).sort())
    for (const [context, table] of Object.entries(codeMasters.投資方針)) {
      expect(codes.投資方針[context]).toEqual(
        Object.entries(table).map(([value, label]) => ({ value, label })),
      )
    }
  })

  it('[CDA-09] 部店は /branches から取り、label にコードを前置する', async () => {
    record('/branches', branchListResponse)

    const options = await fetchBranches()

    expect(lastRequest.url.pathname).toBe('/api/branches')
    expect(options).toEqual(
      branchListResponse.items.map((item) => ({
        value: item.部店コード,
        label: `${item.部店コード} ${item.部店名}`,
      })),
    )
  })

  it('[CDA-10] 扱者は /handlers から部店で絞らずに取り、label にコードを前置する', async () => {
    record('/handlers', handlerListResponse)

    const options = await fetchHandlers()

    expect(lastRequest.url.pathname).toBe('/api/handlers')
    expect([...lastRequest.params.keys()]).toEqual([])
    expect(options).toEqual(
      handlerListResponse.items.map((item) => ({
        value: item.扱者コード,
        label: `${item.扱者コード} ${item.扱者名}`,
      })),
    )
  })

  it('[CDA-11] 名前の無い部店はコードだけを label にする', async () => {
    record('/branches', { items: [{ 部店コード: '999', 部店名: null }] })

    const options = await fetchBranches()

    expect(options).toEqual([{ value: '999', label: '999' }])
  })
})

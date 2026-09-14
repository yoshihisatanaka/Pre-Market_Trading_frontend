import { afterEach, describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { apiClient, ApiError } from './client'

/*
 * HTTP クライアント層のテスト。
 *
 * アプリ内の全リクエストがこの 1 インスタンスを通るので、ここでは
 *   - 送信時に X-User-Code が必ず載ること
 *   - あらゆる失敗が ApiError 1 種に畳まれ、画面に出る文言が決まること
 * の 2 点を固定する。
 *
 * 個別の API 層（ca.spec.js など）は「エラーが投げられること」までしか見ていないため、
 * 文言・status・code の契約はこのファイルだけが守っている。
 *
 * シナリオ: docs/unit/api-client.md
 */

/** テスト専用の入口。実在の API を使わないので、他の仕様変更に巻き込まれない */
const PATH = '/__client-test'
const URL_PATTERN = `*/api${PATH}`

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * 指定の本文・ステータスを返すハンドラを立て、届いたリクエストを記録する。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function respond(body, status = 200) {
  server.use(
    http.get(URL_PATTERN, ({ request }) => {
      lastRequest = { url: new URL(request.url), headers: request.headers }
      return HttpResponse.json(body, { status })
    }),
  )
}

/**
 * GET して、投げられた ApiError を返す。
 * 成功してしまった場合はテストを失敗させる（見逃しを作らない）。
 *
 * @param {object} [config] axios のリクエスト設定
 * @returns {Promise<ApiError>}
 */
async function captureError(config) {
  try {
    await apiClient.get(PATH, config)
  } catch (error) {
    return error
  }
  throw new Error('エラーが投げられませんでした')
}

describe('api/client', () => {
  it('[CLA-01] 全リクエストに X-User-Code を載せ、baseURL /api を前置する', async () => {
    respond({ ok: true })

    await apiClient.get(PATH)

    // 値は vitest.config.js の test.env.VITE_USER_CODE で固定してある
    expect(lastRequest.headers.get('X-User-Code')).toBe('test-user')
    expect(lastRequest.url.pathname).toBe(`/api${PATH}`)
  })

  it('[CLA-02] 成功応答はそのまま返す', async () => {
    respond({ ok: true, items: [] })

    const response = await apiClient.get(PATH)

    expect(response.status).toBe(200)
    expect(response.data).toEqual({ ok: true, items: [] })
  })

  it('[CLA-03] 本文の message を detail より優先して使う', async () => {
    respond({ message: '在庫が不足しています', code: 'OUT_OF_STOCK', detail: '別の文言' }, 400)

    const error = await captureError()

    expect(error.message).toBe('在庫が不足しています')
    expect(error.status).toBe(400)
    expect(error.code).toBe('OUT_OF_STOCK')
  })

  it('[CLA-04] detail が文字列ならそれをそのまま使う', async () => {
    respond({ detail: '休場日 20260101 は既に登録されています' }, 409)

    const error = await captureError()

    expect(error.message).toBe('休場日 20260101 は既に登録されています')
    expect(error.status).toBe(409)
    expect(error.code).toBeNull()
  })

  it('[CLA-05] detail が配列なら「項目名: msg」を / で連結する', async () => {
    respond(
      {
        detail: [
          { loc: ['body', '市場関与率'], msg: '指定できる下限を下回っています', type: 'value_error' },
          { loc: ['body', '注文上限株数'], msg: '整数で入力してください', type: 'value_error' },
        ],
      },
      422,
    )

    const error = await captureError()

    expect(error.message).toBe(
      '市場関与率: 指定できる下限を下回っています / 注文上限株数: 整数で入力してください',
    )
    expect(error.status).toBe(422)
  })

  it('[CLA-06] loc が body / query だけなら項目名を前置しない', async () => {
    respond(
      {
        detail: [
          { loc: ['body'], msg: '本文が不正です', type: 'value_error' },
          { loc: ['query'], msg: 'クエリが不正です', type: 'value_error' },
        ],
      },
      422,
    )

    const error = await captureError()

    // 「値の出所」は利用者に見せる情報ではないので落とす
    expect(error.message).toBe('本文が不正です / クエリが不正です')
  })

  it('[CLA-07] msg を取り出せない要素は捨てて連結する', async () => {
    respond(
      {
        detail: [
          { loc: ['body', '銘柄コード'], type: 'missing' },
          { loc: ['body', '数量'], msg: '', type: 'value_error' },
          { loc: ['body', '単価'], msg: '0 より大きい値を入力してください', type: 'value_error' },
        ],
      },
      422,
    )

    const error = await captureError()

    // 空の区切り（' / ' が続く・先頭や末尾に付く）が出ないこと
    expect(error.message).toBe('単価: 0 より大きい値を入力してください')
  })

  it('[CLA-08] 400 で文言が取れなければ既定の入力エラー文言に落とす', async () => {
    respond({}, 400)

    const error = await captureError()

    expect(error.message).toBe('入力内容に誤りがあります。')
    expect(error.status).toBe(400)
    expect(error.code).toBeNull()
  })

  it('[CLA-09] 401 は既定でログインを促す文言になる', async () => {
    respond({}, 401)

    expect((await captureError()).message).toBe('ログインが必要です。')
  })

  it('[CLA-10] 403 は既定で権限が無い旨の文言になる', async () => {
    respond({}, 403)

    expect((await captureError()).message).toBe('この操作を行う権限がありません。')
  })

  it('[CLA-11] 404 は既定で対象が見つからない旨の文言になる', async () => {
    respond({}, 404)

    expect((await captureError()).message).toBe('対象が見つかりませんでした。')
  })

  it('[CLA-12] 5xx は既定でサーバエラーの文言になる', async () => {
    respond({}, 500)
    expect((await captureError()).message).toBe('サーバーでエラーが発生しました。')

    respond({}, 503)
    expect((await captureError()).message).toBe('サーバーでエラーが発生しました。')
  })

  it('[CLA-13] 既定文言を持たない status は汎用の文言になる', async () => {
    respond({}, 409)

    const error = await captureError()

    expect(error.message).toBe('エラーが発生しました。')
    expect(error.status).toBe(409)
  })

  it('[CLA-14] タイムアウトはタイムアウト専用の文言になる', async () => {
    server.use(
      http.get(URL_PATTERN, async () => {
        await delay(200)
        return HttpResponse.json({})
      }),
    )

    /*
     * jsdom + MSW の XHR インターセプタは XMLHttpRequest.timeout を実装していないため、
     * 既定の xhr アダプタでは時間切れが起きない（応答がそのまま返ってしまう）。
     * このテストだけ Node の http アダプタに切り替えて、axios 自身のタイマを働かせる。
     * 絶対 URL にするのは http アダプタが相対 URL を解決できないため
     * （jsdom の origin は vitest.config.js で http://localhost:5173 に固定してある）。
     */
    const error = await captureError({
      baseURL: 'http://localhost:5173/api',
      timeout: 20,
      adapter: 'http',
    })

    expect(error.message).toBe('通信がタイムアウトしました。時間をおいて再度お試しください。')
    expect(error.status).toBeNull()
    expect(error.code).toBe('ECONNABORTED')
  })

  it('[CLA-15] 応答が返らないときは接続できない旨の文言になる', async () => {
    server.use(http.get(URL_PATTERN, () => HttpResponse.error()))

    const error = await captureError()

    expect(error.message).toBe('サーバーに接続できませんでした。')
    expect(error.status).toBeNull()
  })

  it('[CLA-16] 投げられるのは ApiError で、元のエラーを cause に持つ', async () => {
    respond({}, 500)

    const error = await captureError()

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ApiError')
    expect(error.cause?.response?.status).toBe(500)
  })
})

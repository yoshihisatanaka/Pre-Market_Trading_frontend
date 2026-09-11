import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { hardLimitSetting } from '@/mocks/fixtures/hardLimits'
import { fetchHardLimits, updateHardLimits } from './hardLimits'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の宣言と突き合わせる。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない（実際、備考を送らないと実 API は NULL に落とすが、モックは現在値を保っていた）。
 * この層で本文のキー・値の型を固定しておくと、ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-hard-limits.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'put'} method
 * @param {string} path `*` 始まりのパス
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(method, path, body, status = 200) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        headers: request.headers,
        // GET は本文が無いので読まない（読むと空文字で例外になる）
        body: method === 'put' ? await request.json() : null,
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

const PATH = '*/api/slice-settings'

/** updateHardLimits() に渡すアプリ内モデル側の引数。個々のテストで一部だけ差し替える */
const updateArgs = {
  participationRate: 0.02,
  maxQuantity: 5000,
  maxAmount: 250000,
  sliceEnabled: true,
  note: '運用チーム調整分',
  updatedAt: '2026-09-01 10:30:00',
}

describe('api/hardLimits', () => {
  it('[HLA-01] 取得は /slice-settings をクエリなしで呼ぶ', async () => {
    record('get', PATH, hardLimitSetting)

    await fetchHardLimits()

    expect(lastRequest.url.pathname).toBe('/api/slice-settings')
    // 単一リソースなので絞り込みもページングも無い
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[HLA-02] 日本語キーの応答が camelCase のモデルに変換される', async () => {
    record('get', PATH, hardLimitSetting)

    const settings = await fetchHardLimits()

    expect(settings).toEqual({
      id: hardLimitSetting['ID'],
      participationRate: hardLimitSetting['市場関与率'],
      maxQuantity: hardLimitSetting['大口数量閾値'],
      maxAmount: hardLimitSetting['大口金額閾値'],
      // 0/1 の integer を boolean にするのはこの層の仕事
      sliceEnabled: true,
      note: hardLimitSetting['備考'],
      updatedAt: hardLimitSetting['更新日時'],
      updatedBy: hardLimitSetting['更新者'],
    })
  })

  it('[HLA-03] スライス有効フラグ 0 は sliceEnabled false になる', async () => {
    record('get', PATH, { ...hardLimitSetting, スライス有効フラグ: 0 })

    const settings = await fetchHardLimits()

    expect(settings.sliceEnabled).toBe(false)
  })

  it('[HLA-04] 備考が null のときは null のまま返る', async () => {
    record('get', PATH, { ...hardLimitSetting, 備考: null })

    const settings = await fetchHardLimits()

    // '' に丸めると、そのまま送り返したときに実 DB の NULL を空文字へ書き換えてしまう
    expect(settings.note).toBeNull()
  })

  it('[HLA-05] 本文が返らないときは null になる', async () => {
    server.use(http.get(PATH, () => new HttpResponse(null, { status: 204 })))

    await expect(fetchHardLimits()).resolves.toBeNull()
  })

  it('[HLA-06] 更新の本文が SliceSettingUpdateRequest の日本語キーになる', async () => {
    record('put', PATH, hardLimitSetting)

    await updateHardLimits(updateArgs)

    expect(lastRequest.url.pathname).toBe('/api/slice-settings')
    expect(lastRequest.body).toEqual({
      市場関与率: updateArgs.participationRate,
      大口数量閾値: updateArgs.maxQuantity,
      大口金額閾値: updateArgs.maxAmount,
      スライス有効フラグ: 1,
      備考: updateArgs.note,
      更新日時: updateArgs.updatedAt,
    })
  })

  it('[HLA-07] sliceEnabled は boolean ではなく 0/1 で送る', async () => {
    record('put', PATH, hardLimitSetting)

    await updateHardLimits({ ...updateArgs, sliceEnabled: false })

    expect(lastRequest.body['スライス有効フラグ']).toBe(0)
  })

  it('[HLA-08] 画面に出さない備考も必ず送る', async () => {
    record('put', PATH, hardLimitSetting)

    await updateHardLimits(updateArgs)

    // 省略すると実 API は備考を NULL に落とす（2026-09-11 実測）
    expect(lastRequest.body['備考']).toBe(updateArgs.note)
  })

  it('[HLA-09] 更新に X-User-Code ヘッダが載る', async () => {
    record('put', PATH, hardLimitSetting)

    await updateHardLimits(updateArgs)

    expect(lastRequest.headers.get('X-User-Code')).toBeTruthy()
  })

  it('[HLA-10] 422 は項目ごとの理由をつないだ ApiError になる', async () => {
    const detail = [
      {
        type: 'greater_than_equal',
        loc: ['body', '市場関与率'],
        msg: '指定できる下限を下回っています',
        input: 0,
        ctx: { ge: 0.0001 },
      },
      {
        type: 'greater_than_equal',
        loc: ['body', '大口金額閾値'],
        msg: '指定できる下限を下回っています',
        input: 0,
        ctx: { ge: 1 },
      },
    ]
    record('put', PATH, { detail }, 422)

    await expect(updateHardLimits(updateArgs)).rejects.toMatchObject({
      status: 422,
      // 実 API の msg は項目名を含まないので、client.js が loc から補って区別できるようにする
      message: '市場関与率: 指定できる下限を下回っています / 大口金額閾値: 指定できる下限を下回っています',
    })
  })
})

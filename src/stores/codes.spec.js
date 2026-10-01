import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { codeEntries, codeMasters } from '@/mocks/fixtures/codes'
import { useCodesStore } from './codes'

/*
 * 既定の MSW ハンドラに当てる。期待値はフィクスチャ（codes.js の codeEntries）から導く。
 *
 * このストアで守りたいのは「画面が読み込みの完了を待たなくてよい」という一点。
 * optionsFor() が undefined を返すと BaseSelect の options prop の型検証が落ちるので、
 * 未取得・未知の名前・取得失敗のいずれでも配列を返すことを固定する。
 *
 * シナリオ: docs/unit/stores-codes.md
 */

const toOptions = (entries) => entries.map(({ code, label }) => ({ value: code, label }))

const BRANCH_KEY = '部店'
const expectedBranchOptions = toOptions(codeEntries(BRANCH_KEY))

// codeMasters に存在しないコードマスタ名
const UNKNOWN_KEY = '存在しない区分'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

describe('stores/codes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[CDS-01] 未取得でも optionsFor は空配列を返す', () => {
    const store = useCodesStore()

    expect(store.optionsFor(BRANCH_KEY)).toEqual([])
  })

  it('[CDS-02] load すると選択肢が埋まる', async () => {
    const store = useCodesStore()

    await store.load()

    expect(store.optionsFor(BRANCH_KEY)).toEqual(expectedBranchOptions)
    expect(expectedBranchOptions.length).toBeGreaterThan(0)
  })

  it('[CDS-03] 未知のコードマスタ名は空配列を返す', async () => {
    const store = useCodesStore()
    await store.load()

    expect(store.optionsFor(UNKNOWN_KEY)).toEqual([])
  })

  it('[CDS-04] 取得中は loading が立つ', async () => {
    server.use(
      http.get('*/api/codes', async () => {
        await delay(10)
        return HttpResponse.json(codeMasters)
      }),
    )
    const store = useCodesStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[CDS-05] 取得に失敗しても optionsFor は空配列を返し続ける', async () => {
    server.use(
      http.get('*/api/codes', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useCodesStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.optionsFor(BRANCH_KEY)).toEqual([])
  })

  it('[CDS-06] 選択肢は value / label の 2 キーだけを持つ', async () => {
    const store = useCodesStore()
    await store.load()

    const option = store.optionsFor(BRANCH_KEY)[0]
    // code のまま外へ出さない（BaseSelect の options がそのまま受け取れる形にする）
    expect(Object.keys(option).sort()).toEqual(['label', 'value'])
  })

  it('[CDS-07] /codes のカテゴリと /handlers の扱者が同じ辞書で引ける', async () => {
    const store = useCodesStore()
    await store.load()

    expect(store.optionsFor('口座区分')).toEqual(toOptions(codeEntries('口座区分')))
    expect(store.optionsFor('扱者')).toEqual(toOptions(codeEntries('扱者')))
    expect(store.optionsFor('扱者').length).toBeGreaterThan(0)
  })

  it('[CDS-08] 投資方針は法人区分で選択肢が切り替わり、法人区分が無ければ空配列', async () => {
    const store = useCodesStore()
    await store.load()

    for (const corporateType of Object.keys(codeMasters.投資方針)) {
      expect(store.optionsFor('投資方針', corporateType)).toEqual(
        toOptions(codeEntries('投資方針', corporateType)),
      )
    }
    expect(store.optionsFor('投資方針', '0')).not.toEqual(store.optionsFor('投資方針', '1'))
    expect(store.optionsFor('投資方針')).toEqual([])
    expect(store.optionsFor('投資方針', '9')).toEqual([])
  })

  it('[CDS-09] /branches が失敗したら全体を失敗にし、選択肢は空のまま', async () => {
    server.use(
      http.get('*/api/branches', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useCodesStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.optionsFor('口座区分')).toEqual([])
  })

  it('[CDS-10] 取得に成功すると ready が立つ（取得前・取得中は立たない）', async () => {
    const store = useCodesStore()
    expect(store.ready).toBe(false)

    const pending = store.load()
    expect(store.ready).toBe(false)
    await pending

    expect(store.ready).toBe(true)
  })

  it('[CDS-11] 取得に失敗すると ready は立たず、再試行で成功すれば立つ', async () => {
    server.use(
      http.get(
        '*/api/codes',
        () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
        { once: true },
      ),
    )
    const store = useCodesStore()

    await store.load()
    expect(store.ready).toBe(false)

    await store.load()
    expect(store.ready).toBe(true)
    expect(store.optionsFor('口座区分').length).toBeGreaterThan(0)
  })
})

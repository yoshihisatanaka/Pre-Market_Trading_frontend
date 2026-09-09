import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { hardLimitSetting } from '@/mocks/fixtures/hardLimits'
import { useHardLimitsStore } from './hardLimits'

/*
 * 期待値はフィクスチャから導く（0.05 / 10000 / 1000000 を直接書かない）。
 * バックエンドのキーは日本語なので、生の形を読むのはこの定義部分だけにする。
 */
const RATE = hardLimitSetting['市場関与率']
const QUANTITY = hardLimitSetting['大口数量閾値']
const AMOUNT = hardLimitSetting['大口金額閾値']

// 保存に使う「現在値とは違う、有効な範囲の値」もフィクスチャから導く
const NEW_RATE = RATE / 2
const NEW_QUANTITY = QUANTITY / 2
const NEW_AMOUNT = AMOUNT / 2

// モックが 400 で拒む値（市場関与率の下限は 0.0001）
const INVALID_RATE = 0

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const errorHandler = () =>
  http.get('*/api/slice-settings', () =>
    HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }),
  )
// 本文なし（204）。未設定を表す応答
const emptyHandler = () =>
  http.get('*/api/slice-settings', () => new HttpResponse(null, { status: 204 }))
// スライス有効フラグだけを 0 にした設定（画面に無い項目が保存で書き換わらないことの確認用）
const sliceDisabledHandler = () =>
  http.get('*/api/slice-settings', () =>
    HttpResponse.json({ ...hardLimitSetting, スライス有効フラグ: 0 }),
  )

// シナリオ: docs/unit/stores-hard-limits.md
describe('useHardLimitsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[HLS-01] load で現在のハードリミットを読み込む', async () => {
    const store = useHardLimitsStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.settings).toMatchObject({
      participationRate: RATE,
      maxQuantity: QUANTITY,
      maxAmount: AMOUNT,
    })
  })

  it('[HLS-02] 取得が失敗したとき error に入り settings は null のままになる', async () => {
    server.use(errorHandler())
    const store = useHardLimitsStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.settings).toBeNull()
    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe(ERROR_MESSAGE)
  })

  it('[HLS-03] 本文が返らないとき isEmpty が true になる', async () => {
    server.use(emptyHandler())
    const store = useHardLimitsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
    expect(store.settings).toBeNull()
  })

  it('[HLS-04] save が成功すると更新後の設定が返り現在値も入れ替わる', async () => {
    const store = useHardLimitsStore()
    await store.load()

    const updated = await store.save({
      participationRate: NEW_RATE,
      maxQuantity: NEW_QUANTITY,
      maxAmount: NEW_AMOUNT,
    })

    expect(store.saveError).toBeNull()
    expect(updated).toMatchObject({
      participationRate: NEW_RATE,
      maxQuantity: NEW_QUANTITY,
      maxAmount: NEW_AMOUNT,
    })
    expect(store.settings).toMatchObject({
      participationRate: NEW_RATE,
      maxQuantity: NEW_QUANTITY,
      maxAmount: NEW_AMOUNT,
    })
  })

  it('[HLS-05] 範囲外の市場関与率で save すると saveError に入り現在値は変わらない', async () => {
    const store = useHardLimitsStore()
    await store.load()

    const updated = await store.save({
      participationRate: INVALID_RATE,
      maxQuantity: NEW_QUANTITY,
      maxAmount: NEW_AMOUNT,
    })

    expect(updated).toBeNull()
    expect(store.saveError).toBeInstanceOf(Error)
    expect(store.saveError.status).toBe(400)
    expect(store.settings.participationRate).toBe(RATE)
    expect(store.settings.maxQuantity).toBe(QUANTITY)
  })

  it('[HLS-06] 画面に無いスライス有効フラグは save で書き換わらない', async () => {
    server.use(sliceDisabledHandler())
    const store = useHardLimitsStore()
    await store.load()
    expect(store.settings.sliceEnabled).toBe(false)

    const updated = await store.save({
      participationRate: NEW_RATE,
      maxQuantity: NEW_QUANTITY,
      maxAmount: NEW_AMOUNT,
    })

    expect(updated.sliceEnabled).toBe(false)
    expect(store.settings.sliceEnabled).toBe(false)
  })

  it('[HLS-07] clearSaveError で保存エラーが消える', async () => {
    const store = useHardLimitsStore()
    await store.load()
    await store.save({
      participationRate: INVALID_RATE,
      maxQuantity: NEW_QUANTITY,
      maxAmount: NEW_AMOUNT,
    })
    expect(store.saveError).not.toBeNull()

    store.clearSaveError()

    expect(store.saveError).toBeNull()
  })
})

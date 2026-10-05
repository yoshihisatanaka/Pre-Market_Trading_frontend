import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { calculationSetting } from '@/mocks/fixtures/calculationSettings'
import { useCalculationSettingsStore } from './calculationSettings'

/*
 * 期待値はフィクスチャから導く（0.00002 / 10 / 0.5 / 5 を直接書かない）。
 * バックエンドのキーは日本語なので、生の形を読むのはこの定義部分だけにする。
 */
const PATH = '*/api/masters/calculation-settings'

const CURRENT = {
  exchangeTaxRate: calculationSetting['取引所税率'],
  localCommissionBp: calculationSetting['現地手数料率_bp'],
  fxSpread: calculationSetting['為替スプレッド'],
  nisaFxMarkupRate: calculationSetting['NISA為替上乗せ率'],
}
// 画面に出さない項目。保存で消えていないことの確認に使う
const HIDDEN = {
  note: calculationSetting['備考'],
  consumptionTaxRate: calculationSetting['消費税率'],
  capitalGainsIncomeTaxRate: calculationSetting['譲渡益所得税率'],
  capitalGainsResidentTaxRate: calculationSetting['譲渡益住民税率'],
}
const UPDATED_AT = calculationSetting['更新日時']

// 保存に使う「現在値とは違う、有効な範囲の値」もフィクスチャから導く
const CHANGED = {
  exchangeTaxRate: CURRENT.exchangeTaxRate * 2,
  localCommissionBp: CURRENT.localCommissionBp * 2,
  fxSpread: CURRENT.fxSpread * 2,
  nisaFxMarkupRate: CURRENT.nisaFxMarkupRate * 2,
}
// モックが 422 で拒む値（NISA為替上乗せ率の上限は 100）
const INVALID_NISA = 100 + 1

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const SAVED_MESSAGE = '仮計算マスタを変更しました。'
const NO_CHANGE_MESSAGE = '変更はありません。'
const CONFLICT_MESSAGE =
  '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'

// 実 API のエラー本文は ErrorResponse（{ detail: string }）
const errorHandler = () =>
  http.get(PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))
// 本文なし（204）。実 API では起きないが、画面の 4 状態を保つための空応答
const emptyHandler = () => http.get(PATH, () => new HttpResponse(null, { status: 204 }))
// 読み込んだ値が古い（サーバ側の更新日時はフィクスチャのまま）。保存で 409 になる
const staleHandler = () =>
  http.get(PATH, () => HttpResponse.json({ ...calculationSetting, 更新日時: '2000-01-01T00:00:00' }))

/**
 * PUT の本文を記録だけして、既定のハンドラへ素通しする（MSW は resolver が何も返さないと次へ進む）。
 * @returns {{ bodies: object[] }}
 */
function recordPut() {
  const recorded = { bodies: [] }
  server.use(
    http.put(PATH, async ({ request }) => {
      recorded.bodies.push(await request.clone().json())
    }),
  )
  return recorded
}

// シナリオ: docs/unit/stores-calculation-settings.md
describe('useCalculationSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[PCS-01] load で現在の仮計算マスタを読み込む', async () => {
    const store = useCalculationSettingsStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.isEmpty).toBe(false)
    expect(store.settings).toMatchObject({ ...CURRENT, ...HIDDEN, updatedAt: UPDATED_AT })
  })

  it('[PCS-02] 取得が失敗したとき error に入り settings は null のままになる', async () => {
    server.use(errorHandler())
    const store = useCalculationSettingsStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.settings).toBeNull()
    expect(store.isEmpty).toBe(false)
    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe(ERROR_MESSAGE)
  })

  it('[PCS-03] 本文が返らないとき isEmpty が true になる', async () => {
    server.use(emptyHandler())
    const store = useCalculationSettingsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
    expect(store.settings).toBeNull()
  })

  it('[PCS-04] save が成功するとサーバの文言が返り現在値も入れ替わる', async () => {
    const store = useCalculationSettingsStore()
    await store.load()

    const message = await store.save(CHANGED)

    expect(message).toBe(SAVED_MESSAGE)
    expect(store.saveError).toBeNull()
    expect(store.settings).toMatchObject(CHANGED)
  })

  it('[PCS-05] 現在値のまま save すると「変更はありません。」が返り値は変わらない', async () => {
    const store = useCalculationSettingsStore()
    await store.load()

    const message = await store.save(CURRENT)

    expect(message).toBe(NO_CHANGE_MESSAGE)
    expect(store.saveError).toBeNull()
    expect(store.settings).toMatchObject({ ...CURRENT, updatedAt: UPDATED_AT })
  })

  it('[PCS-06] save は読み込んだ更新日時を補って送る', async () => {
    const recorded = recordPut()
    const store = useCalculationSettingsStore()
    await store.load()

    await store.save(CHANGED)

    expect(recorded.bodies).toHaveLength(1)
    expect(recorded.bodies[0]['更新日時']).toBe(UPDATED_AT)
  })

  it('[PCS-07] 他の担当者が先に更新していると 409 が saveError に入り現在値は変わらない', async () => {
    server.use(staleHandler())
    const store = useCalculationSettingsStore()
    await store.load()
    const before = store.settings

    const message = await store.save(CHANGED)

    expect(message).toBeNull()
    expect(store.saveError).toBeInstanceOf(Error)
    expect(store.saveError.status).toBe(409)
    expect(store.saveError.message).toBe(CONFLICT_MESSAGE)
    expect(store.settings).toEqual(before)
  })

  it('[PCS-08] 範囲外の NISA為替上乗せ率で save すると saveError に入り現在値は変わらない', async () => {
    const store = useCalculationSettingsStore()
    await store.load()

    const message = await store.save({ ...CHANGED, nisaFxMarkupRate: INVALID_NISA })

    expect(message).toBeNull()
    expect(store.saveError).toBeInstanceOf(Error)
    expect(store.saveError.status).toBe(422)
    // 実 API の msg は項目名を含まないので、client.js が loc から補っている
    expect(store.saveError.message).toContain('NISA為替上乗せ率')
    expect(store.settings).toMatchObject(CURRENT)
    // 取得側のエラーとは別に持つ（保存の失敗で現在値の表示をエラーに切り替えない）
    expect(store.error).toBeNull()
  })

  it('[PCS-09] 読み込む前の save は送らずに null を返す', async () => {
    const recorded = recordPut()
    const store = useCalculationSettingsStore()

    const message = await store.save(CHANGED)

    expect(message).toBeNull()
    expect(recorded.bodies).toHaveLength(0)
    expect(store.saveError).toBeNull()
  })

  it('[PCS-10] 画面に無い備考・消費税率・譲渡益税率は save で書き換わらない', async () => {
    const store = useCalculationSettingsStore()
    await store.load()

    await store.save(CHANGED)

    expect(store.settings).toMatchObject(HIDDEN)
  })

  it('[PCS-11] clearSaveError で保存エラーが消える', async () => {
    const store = useCalculationSettingsStore()
    await store.load()
    await store.save({ ...CHANGED, nisaFxMarkupRate: INVALID_NISA })
    expect(store.saveError).not.toBeNull()

    store.clearSaveError()

    expect(store.saveError).toBeNull()
  })

  it('[PCS-12] 保存中は saving だけが true になり loading は立たない', async () => {
    const store = useCalculationSettingsStore()
    await store.load()

    const pending = store.save(CHANGED)

    expect(store.saving).toBe(true)
    expect(store.loading).toBe(false)

    await pending

    expect(store.saving).toBe(false)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { feePreferences } from '@/mocks/fixtures/feePreferences'
import { FEE_PREFERENCES_PAGE_SIZE, useFeePreferencesStore } from './feePreferences'

/*
 * 既定の MSW ハンドラに当てる。期待値はフィクスチャと表示件数から導き、52 / 50 / 1230001 のような値を
 * 直接書かない。
 */

const PAGE_SIZE = FEE_PREFERENCES_PAGE_SIZE
const TOTAL = feePreferences.length
const LIST_PATH = '*/api/masters/fee-preferences'

/** 実 API と同じ並び（口座番号の昇順） */
const sorted = [...feePreferences].sort((a, b) => a.口座番号 - b.口座番号)
const accountsOf = (rows) => rows.map((row) => String(row.口座番号))
const allAccounts = accountsOf(sorted)
const accounts = (store) => store.items.map((item) => item.accountNumber)

/** 2 番目に現れる部店（先頭の部店だと 1 ページ目と区別しにくい） */
const BRANCH = [...new Set(sorted.map((row) => row.部店コード))][1]
const branchAccounts = accountsOf(sorted.filter((row) => row.部店コード === BRANCH))

/** 優遇の登録が無い有効な口座（各部店の末尾）。新規追加に使う */
const registered = new Set(feePreferences.map((row) => row.口座番号))
const unregistered = customers
  .filter((customer) => customer.取消区分 === 0 && !registered.has(customer.口座番号))
  .map((customer) => String(customer.口座番号))

/** 既に登録のある口座。重複で弾かれる */
const EXISTING_ACCOUNT = allAccounts[0]
const duplicateMessage = (account) => `口座番号(${account})の手数料優遇は既に登録されています`

/** 手数料パターンマスタに無いパターン（モックの登録済みは A〜D） */
const UNREGISTERED_PATTERN = 'E'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

// シナリオ: docs/unit/stores-fee-preferences.md
describe('stores/feePreferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[FPS-01] 既定の読み込みで 1 ページ目が入り、total は有効行の件数になる', async () => {
    const store = useFeePreferencesStore()

    await store.load()

    // 2 ページ目ができないと FPS-02 が意味を失う
    expect(TOTAL).toBeGreaterThan(PAGE_SIZE)
    expect(store.total).toBe(TOTAL)
    expect(accounts(store)).toEqual(allAccounts.slice(0, PAGE_SIZE))
  })

  it('[FPS-02] offset を渡すと 2 ページ目の行が入る', async () => {
    const store = useFeePreferencesStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(accounts(store)).toEqual(allAccounts.slice(PAGE_SIZE))
  })

  it('[FPS-03] 部店で絞り込む', async () => {
    const store = useFeePreferencesStore()

    await store.load({ branchCode: BRANCH })

    expect(branchAccounts.length).toBeGreaterThan(0)
    expect(branchAccounts.length).toBeLessThan(TOTAL)
    expect(store.branchCode).toBe(BRANCH)
    expect(store.total).toBe(branchAccounts.length)
    expect(accounts(store)).toEqual(branchAccounts)
  })

  it('[FPS-04] 取得に失敗したときは error に入り、items は空で loading が戻る', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useFeePreferencesStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
    // 空とエラーは別の状態
    expect(store.isEmpty).toBe(false)
  })

  it('[FPS-05] 0 件の応答では isEmpty が立つ', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, fee_preferences: [] }),
      ),
    )
    const store = useFeePreferencesStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })

  it('[FPS-06] 登録すると camelCase の 1 件が返り、total が 1 増える', async () => {
    const store = useFeePreferencesStore()
    await store.load()
    const account = unregistered[0]

    const created = await store.create({ accountNumber: account, fxSpread: '0' })

    expect(created).toMatchObject({ accountNumber: account, fxSpread: 0, feePattern: '' })
    expect(created.id).not.toBe('')
    expect(store.total).toBe(TOTAL + 1)
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
  })

  it('[FPS-07] 既に登録のある口座は validationErrors に入り、登録しない', async () => {
    const store = useFeePreferencesStore()
    await store.load()

    const created = await store.create({ accountNumber: EXISTING_ACCOUNT })

    expect(created).toBeNull()
    expect(store.validationErrors).toEqual([duplicateMessage(EXISTING_ACCOUNT)])
    expect(store.createError).toBeNull()
    expect(store.total).toBe(TOTAL)
  })

  it('[FPS-08] 変更の 409 は updateError に入り、items は変わらない', async () => {
    const detail = '他のユーザーによって手数料優遇が更新されています。最新データを再取得してください。'
    server.use(
      http.put(`${LIST_PATH}/:id`, () => HttpResponse.json({ detail }, { status: 409 })),
    )
    const store = useFeePreferencesStore()
    await store.load()
    const before = store.items.map((item) => ({ ...item }))

    const updated = await store.update({ ...store.items[0], fxSpread: '0.5' })

    expect(updated).toBeNull()
    expect(store.updateError.message).toBe(detail)
    expect(store.updateValidationErrors).toEqual([])
    expect(store.items).toEqual(before)
  })

  it('[FPS-09] 削除するとその行が消え、total が 1 減る', async () => {
    const store = useFeePreferencesStore()
    await store.load()
    const target = store.items[0]

    const deleted = await store.remove(target.id)

    expect(deleted).toBe(true)
    expect(store.total).toBe(TOTAL - 1)
    expect(store.items.map((item) => item.id)).not.toContain(target.id)
  })

  it('[FPS-10] 警告は 1 回目で止まり、承知して押し直すと登録される', async () => {
    const store = useFeePreferencesStore()
    await store.load()
    // 先頭の部店ではない口座を使う（FPS-06 と同じ口座に寄らないように）
    const account = unregistered[1]
    const input = { accountNumber: account, feePattern: UNREGISTERED_PATTERN }

    const first = await store.create(input)

    expect(first).toBeNull()
    expect(store.validationWarnings.length).toBeGreaterThan(0)
    expect(store.validationWarnings.join()).toContain(`手数料パターン(${UNREGISTERED_PATTERN})`)
    expect(store.validationErrors).toEqual([])
    expect(store.total).toBe(TOTAL)

    const second = await store.create({ ...input, acknowledgedWarnings: true })

    expect(second).toMatchObject({ accountNumber: account, feePattern: UNREGISTERED_PATTERN })
    expect(store.validationWarnings).toEqual([])
    expect(store.total).toBe(TOTAL + 1)
  })
})

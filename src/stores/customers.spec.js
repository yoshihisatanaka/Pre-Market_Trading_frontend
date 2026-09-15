import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { canceledCustomers, customers } from '@/mocks/fixtures/customers'
import { CUSTOMERS_PAGE_SIZE, useCustomersStore } from './customers'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャと表示件数から導き、56 / 50 のような数値を直接書かない。
 *
 * シナリオ: docs/unit/stores-customers.md
 */

const PAGE_SIZE = CUSTOMERS_PAGE_SIZE
const TOTAL = customers.length

/** 実 API と同じ並び（口座番号の昇順）。フィクスチャは生成順のまま置かれている */
const sorted = [...customers].sort((a, b) => a.口座番号 - b.口座番号)
const expectedNumbers = sorted.map((row) => String(row.口座番号))

/** 条件に当たる行の口座番号（絞り込みの期待値をフィクスチャから導くための共通処理） */
const numbersMatching = (predicate) =>
  sorted.filter(predicate).map((row) => String(row.口座番号))

// 絞り込みに使う値もフィクスチャの先頭行から取る
const head = sorted[0]
const BRANCH_CODE = head.部店コード
const ACCOUNT_NUMBER = String(head.口座番号)
const CUSTOMER_NAME = head.顧客名
const CUSTOMER_KANA = head.顧客名カナ

// どの顧客名・カナにも当たらない文字列
const NO_MATCH = '該当なし'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 一覧を 500 にする差し替え */
function failList() {
  server.use(
    http.get('*/api/masters/customers', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
  )
}

/**
 * 一覧の応答を遅らせる差し替え。
 * offset ごとに待ち時間を変えられるので、「先に投げたほうが遅く返る」状況を作れる。
 *
 * @param {(offset: number) => number} waitFor offset に対する待ち時間（ミリ秒）
 */
function slowList(waitFor) {
  server.use(
    http.get('*/api/masters/customers', async ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
      await delay(waitFor(offset))
      return HttpResponse.json({
        total: TOTAL,
        customers: sorted.slice(offset, offset + PAGE_SIZE),
      })
    }),
  )
}

const numbersOf = (store) => store.items.map((item) => item.accountNumber)

describe('stores/customers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[CUS-01] 既定の読み込みで 1 ページ目が口座番号の昇順で入る', async () => {
    const store = useCustomersStore()

    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(store.offset).toBe(0)
    expect(store.limit).toBe(PAGE_SIZE)
    expect(numbersOf(store)).toEqual(expectedNumbers.slice(0, PAGE_SIZE))
  })

  it('[CUS-02] offset を渡すとその位置から読み込む', async () => {
    const store = useCustomersStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(numbersOf(store)).toEqual(expectedNumbers.slice(PAGE_SIZE))
    // 全件がちょうど 1 ページに収まっていたら、このシナリオは意味を失う
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[CUS-03] 部店コードで絞り込む', async () => {
    const expected = numbersMatching((row) => row.部店コード === BRANCH_CODE)
    const store = useCustomersStore()

    await store.load({ branchCode: BRANCH_CODE })

    expect(store.branchCode).toBe(BRANCH_CODE)
    expect(store.total).toBe(expected.length)
    expect(numbersOf(store)).toEqual(expected)
  })

  it('[CUS-04] 顧客名は氏名にもカナにも当たる（部分一致）', async () => {
    const store = useCustomersStore()

    await store.load({ customerName: CUSTOMER_NAME })
    const byName = numbersOf(store)

    await store.load({ customerName: CUSTOMER_KANA })
    const byKana = numbersOf(store)

    expect(store.customerName).toBe(CUSTOMER_KANA)
    expect(byName).toEqual(numbersMatching((row) => row.顧客名.includes(CUSTOMER_NAME)))
    expect(byKana).toEqual(numbersMatching((row) => row.顧客名カナ.includes(CUSTOMER_KANA)))
    expect(byName.length).toBeGreaterThan(0)
    expect(byKana).toEqual(byName)
  })

  it('[CUS-05] 口座番号は完全一致で 1 件に絞り込む', async () => {
    const store = useCustomersStore()

    await store.load({ accountNumber: ACCOUNT_NUMBER })

    expect(store.accountNumber).toBe(ACCOUNT_NUMBER)
    expect(numbersOf(store)).toEqual([ACCOUNT_NUMBER])
  })

  it('[CUS-06] 区分（取引停止・口座区分・法人区分）で絞り込む', async () => {
    const store = useCustomersStore()

    await store.load({ restriction: '1' })
    expect(store.restriction).toBe('1')
    expect(numbersOf(store)).toEqual(numbersMatching((row) => row.取引停止区分_全取引 === 1))
    expect(store.items.length).toBeGreaterThan(0)

    await store.load({ accountType: '1' })
    expect(store.accountType).toBe('1')
    // 条件を変えたら前の条件は残らない
    expect(store.restriction).toBe('')
    expect(numbersOf(store)).toEqual(numbersMatching((row) => row.口座区分 === '1'))
    expect(store.items.length).toBeGreaterThan(0)

    await store.load({ corporateType: '1' })
    expect(store.corporateType).toBe('1')
    expect(numbersOf(store)).toEqual(numbersMatching((row) => row.法人区分 === '1'))
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[CUS-07] 該当が無いときは空とみなす', async () => {
    const store = useCustomersStore()

    await store.load({ customerName: NO_MATCH })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[CUS-08] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    failList()
    const store = useCustomersStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    // 空とエラーは別の状態として出し分ける
    expect(store.isEmpty).toBe(false)
  })

  it('[CUS-09] 取得中は loading が立つ', async () => {
    slowList(() => 10)
    const store = useCustomersStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[CUS-10] reload は条件とページ位置を保ったまま読み直す', async () => {
    const expected = numbersMatching((row) => row.部店コード === BRANCH_CODE)
    const store = useCustomersStore()
    await store.load({ offset: 0, branchCode: BRANCH_CODE })

    await store.reload()

    expect(store.branchCode).toBe(BRANCH_CODE)
    expect(store.offset).toBe(0)
    expect(numbersOf(store)).toEqual(expected)
  })

  it('[CUS-11] 読むだけの一覧なので登録・更新・削除を公開しない', () => {
    const store = useCustomersStore()

    expect(store.create).toBeUndefined()
    expect(store.update).toBeUndefined()
    expect(store.remove).toBeUndefined()
    expect(store.creating).toBeUndefined()
    expect(store.deleting).toBeUndefined()
  })

  it('[CUS-12] 古い応答が新しい結果を上書きしない', async () => {
    // 先に投げる 2 ページ目を遅く、後から投げる 1 ページ目を速く返す
    slowList((offset) => (offset === 0 ? 10 : 60))
    const store = useCustomersStore()

    const stale = store.load({ offset: PAGE_SIZE })
    const latest = store.load({ offset: 0 })
    await Promise.all([stale, latest])

    expect(numbersOf(store)).toEqual(expectedNumbers.slice(0, PAGE_SIZE))
  })

  it('[CUS-13] 削除済みの顧客は一覧に含まれない', async () => {
    const deletedNumber = String(canceledCustomers[0].口座番号)
    // フィクスチャに削除済みの行が無ければ、このシナリオは意味を失う
    expect(canceledCustomers.length).toBeGreaterThan(0)

    const store = useCustomersStore()
    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(numbersOf(store)).not.toContain(deletedNumber)
  })
})

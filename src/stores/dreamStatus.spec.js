import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { dreamOrders, dreamStatusCodes } from '@/mocks/fixtures/dreamStatus'
import { DREAM_STATUS_PAGE_SIZE, useDreamStatusStore } from './dreamStatus'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順）に当てる。
 * 期待値はフィクスチャと表示件数から導き、56 / 50 のような数値を直接書かない。
 */

const PAGE_SIZE = DREAM_STATUS_PAGE_SIZE
const TOTAL = dreamOrders.length
const LIST_PATH = '*/api/orders/dream-status'
const STATUSES_PATH = '*/api/orders/dream-status/statuses'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 実 API と同じ並び（作成日時の新しい順）。フィクスチャは ID の昇順で置かれている */
const sorted = [...dreamOrders].sort((a, b) => b.作成日時.localeCompare(a.作成日時))
const idsMatching = (predicate) => sorted.filter(predicate).map((row) => String(row.ID))
const allIds = sorted.map((row) => String(row.ID))

const idsOf = (store) => store.items.map((item) => item.id)

// 絞り込みに使う値もフィクスチャから取る（先頭行 = いちばん新しい注文）
const head = sorted[0]
const withReceipt = sorted.find((row) => row.受注番号)

const CHANGE_PATH = '*/api/orders/dream-status/:orderId'

/** いま読み込んでいるページの、状況が 9（登録失敗）の最初の行 */
const registrationErrorIn = (store) => store.items.find((item) => item.status === '9')

/** 一覧の GET を数える（応答は既定ハンドラに任せる） */
function countListRequests() {
  const counter = { count: 0 }
  server.use(
    http.get(LIST_PATH, () => {
      counter.count += 1
    }),
  )
  return counter
}

function failList() {
  server.use(
    http.get(LIST_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
  )
}

// シナリオ: docs/unit/stores-dream-status.md
describe('stores/dreamStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[DSS-01] 既定の読み込みで 1 ページ目が作成日時の新しい順に入る', async () => {
    const store = useDreamStatusStore()

    await store.load()

    expect(store.total).toBe(TOTAL)
    expect(store.limit).toBe(PAGE_SIZE)
    expect(store.offset).toBe(0)
    expect(idsOf(store)).toEqual(allIds.slice(0, PAGE_SIZE))
  })

  it('[DSS-02] offset を渡すとその位置から読み込む', async () => {
    const store = useDreamStatusStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(idsOf(store)).toEqual(allIds.slice(PAGE_SIZE, PAGE_SIZE * 2))
    // 全件が 1 ページに収まっていたら、このシナリオは意味を失う
    expect(store.items.length).toBeGreaterThan(0)
  })

  it('[DSS-03] Dream状況のコードで絞り込む', async () => {
    const expected = idsMatching((row) => row.Dream状況 === '9')
    const store = useDreamStatusStore()

    await store.load({ status: '9' })

    expect(store.status).toBe('9')
    expect(store.total).toBe(expected.length)
    expect(idsOf(store)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('[DSS-04] 擬似コード ERROR は登録失敗と取消失敗の両方に当たる', async () => {
    const expected = idsMatching((row) => ['9', 'C9'].includes(row.Dream状況))
    const store = useDreamStatusStore()

    await store.load({ status: 'ERROR' })

    expect(idsOf(store)).toEqual(expected)
    // 両方の状況を含むフィクスチャでないと、このシナリオは意味を失う
    const statuses = new Set(store.items.map((item) => item.status))
    expect(statuses).toEqual(new Set(['9', 'C9']))
  })

  it('[DSS-05] 部店と口座番号の両方に合う行だけにする', async () => {
    const expected = idsMatching((row) => row.部店 === head.部店 && row.口座番号 === head.口座番号)
    const store = useDreamStatusStore()

    await store.load({ branchCode: head.部店, accountNumber: String(head.口座番号) })

    expect(store.branchCode).toBe(head.部店)
    expect(store.accountNumber).toBe(String(head.口座番号))
    expect(idsOf(store)).toEqual(expected)
    // 部店だけで絞るより狭くなっていること
    expect(expected.length).toBeLessThan(idsMatching((row) => row.部店 === head.部店).length)
  })

  it('[DSS-06] 銘柄は Ticker でも銘柄コードでも同じ行に絞り込まれる', async () => {
    const expected = idsMatching((row) => row.Ticker === head.Ticker)
    const store = useDreamStatusStore()

    await store.load({ symbol: head.Ticker })
    const byTicker = idsOf(store)

    await store.load({ symbol: head.銘柄コード })
    const byCode = idsOf(store)

    expect(byTicker).toEqual(expected)
    expect(byCode).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('[DSS-07] 登録日の範囲は注文の作成日で絞る', async () => {
    const date = head.作成日時.slice(0, 10)
    const expected = idsMatching((row) => row.作成日時.slice(0, 10) === date)
    // 「登録日時」列（Dream完了日時）で絞った場合と結果が違うことを前提にする
    const byCompletedAt = idsMatching((row) => (row.Dream完了日時 ?? '').slice(0, 10) === date)
    expect(expected).not.toEqual(byCompletedAt)

    const store = useDreamStatusStore()
    await store.load({ dateFrom: date, dateTo: date })

    expect(store.dateFrom).toBe(date)
    expect(store.dateTo).toBe(date)
    expect(idsOf(store)).toEqual(expected)
  })

  it('[DSS-08] 受付番号で 1 件に絞り込む', async () => {
    const store = useDreamStatusStore()

    await store.load({ receiptNumber: withReceipt.受注番号 })

    expect(store.receiptNumber).toBe(withReceipt.受注番号)
    expect(idsOf(store)).toEqual([String(withReceipt.ID)])
  })

  it('[DSS-09] 条件を変えて読み込むと前の条件は残らない', async () => {
    const store = useDreamStatusStore()

    await store.load({ status: '9', branchCode: head.部店 })
    await store.load({ symbol: head.Ticker })

    expect(store.status).toBe('')
    expect(store.branchCode).toBe('')
    expect(store.symbol).toBe(head.Ticker)
    expect(idsOf(store)).toEqual(idsMatching((row) => row.Ticker === head.Ticker))
  })

  it('[DSS-10] 該当が無いときは空とみなす', async () => {
    const store = useDreamStatusStore()

    await store.load({ receiptNumber: '該当なし' })

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('[DSS-11] 取得に失敗したときは error に入り、空状態にはしない', async () => {
    failList()
    const store = useDreamStatusStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(false)
  })

  it('[DSS-12] 取得中は loading が立つ', async () => {
    server.use(
      http.get(LIST_PATH, async () => {
        await delay(10)
        return HttpResponse.json({ total: 0, orders: [] })
      }),
    )
    const store = useDreamStatusStore()

    const pending = store.load()
    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
  })

  it('[DSS-13] reload は条件とページ位置を保ったまま読み直す', async () => {
    const expected = idsMatching((row) => ['9', 'C9'].includes(row.Dream状況))
    const store = useDreamStatusStore()
    await store.load({ offset: 0, status: 'ERROR' })

    await store.reload()

    expect(store.status).toBe('ERROR')
    expect(store.offset).toBe(0)
    expect(idsOf(store)).toEqual(expected)
  })

  it('[DSS-14] 状況コード一覧はサーバの並びのまま選択肢の形になる', async () => {
    const store = useDreamStatusStore()

    await store.loadStatusCodes()

    expect(store.statusOptions).toEqual(
      dreamStatusCodes.map((raw) => ({ value: raw.コード, label: raw.名称 })),
    )
  })

  it('[DSS-15] 状況コードの取得中は statusCodesLoading だけが立つ', async () => {
    server.use(
      http.get(STATUSES_PATH, async () => {
        await delay(10)
        return HttpResponse.json({ statuses: dreamStatusCodes })
      }),
    )
    const store = useDreamStatusStore()

    const pending = store.loadStatusCodes()
    expect(store.statusCodesLoading).toBe(true)
    // 選択肢の取得中も一覧の表示と検索は止めない
    expect(store.loading).toBe(false)

    await pending
    expect(store.statusCodesLoading).toBe(false)
  })

  it('[DSS-16] 状況コードの取得に失敗しても例外にせず、一覧のエラーにも混ぜない', async () => {
    server.use(
      http.get(STATUSES_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useDreamStatusStore()

    await expect(store.loadStatusCodes()).resolves.toBeNull()

    expect(store.statusOptions).toEqual([])
    expect(store.error).toBeNull()
  })

  it('[DSS-17] 書き込みは STS変更だけを公開し、登録・更新・削除は公開しない', () => {
    const store = useDreamStatusStore()

    expect(typeof store.changeStatus).toBe('function')
    expect(typeof store.clearChangeError).toBe('function')
    expect(store.changing).toBe(false)
    expect(store.changeError).toBeNull()

    expect(store.create).toBeUndefined()
    expect(store.update).toBeUndefined()
    expect(store.remove).toBeUndefined()
  })

  it('[DSS-18] changeStatus は行の updatedAt を合札に送り、結果を返す', async () => {
    let sentBody = null
    server.use(
      http.put(CHANGE_PATH, async ({ request }) => {
        sentBody = await request.clone().json()
      }),
    )
    const store = useDreamStatusStore()
    await store.load()
    const order = registrationErrorIn(store)

    const result = await store.changeStatus({
      order,
      status: '0',
      receiptNumber: '',
      reason: '再送する',
    })

    expect(sentBody.更新日時).toBe(order.updatedAt)
    expect(sentBody.変更後状況).toBe('0')
    expect(result.order).toMatchObject({ id: order.id, status: '0' })
    expect(result.message).toContain(`注文ID ${order.id} `)
  })

  it('[DSS-19] 成功するとページ位置を保ったまま読み直す', async () => {
    const store = useDreamStatusStore()
    await store.load({ offset: PAGE_SIZE })
    const order = registrationErrorIn(store)
    // 2 ページ目に登録失敗の行を持つフィクスチャでないと、このシナリオは意味を失う
    expect(order).toBeDefined()

    await store.changeStatus({ order, status: '0' })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(idsOf(store)).toEqual(allIds.slice(PAGE_SIZE, PAGE_SIZE * 2))
    expect(store.items.find((item) => item.id === order.id).status).toBe('0')
  })

  it('[DSS-20] 成功すると条件を保ったまま読み直し、外れた行は消える', async () => {
    const before = idsMatching((row) => ['9', 'C9'].includes(row.Dream状況))
    const store = useDreamStatusStore()
    await store.load({ status: 'ERROR' })
    const order = registrationErrorIn(store)

    await store.changeStatus({ order, status: '0' })

    expect(store.status).toBe('ERROR')
    expect(store.total).toBe(before.length - 1)
    expect(idsOf(store)).toEqual(before.filter((id) => id !== order.id))
  })

  it('[DSS-21] onSuccess は一覧を読み直す前に結果を受け取って呼ばれる', async () => {
    const store = useDreamStatusStore()
    await store.load()
    const order = registrationErrorIn(store)
    const seen = []

    const result = await store.changeStatus(
      { order, status: '0' },
      {
        onSuccess: (received) => {
          seen.push({
            received,
            statusInList: store.items.find((item) => item.id === order.id).status,
          })
        },
      },
    )

    expect(seen).toHaveLength(1)
    expect(seen[0].received).toBe(result)
    // 呼ばれた時点では一覧はまだ変更前のまま
    expect(seen[0].statusInList).toBe('9')
    expect(store.items.find((item) => item.id === order.id).status).toBe('0')
  })

  it('[DSS-22] 409 で弾かれたら changeError に入れて null を返し、読み直さない', async () => {
    const store = useDreamStatusStore()
    await store.load()
    const order = { ...registrationErrorIn(store), updatedAt: '2000-01-01T00:00:00' }
    const itemsBefore = idsOf(store)
    const listRequests = countListRequests()
    let called = false

    const result = await store.changeStatus(
      { order, status: '0' },
      {
        onSuccess: () => {
          called = true
        },
      },
    )

    expect(result).toBeNull()
    expect(store.changeError?.status).toBe(409)
    expect(store.changeError?.message).toContain(order.updatedAt)
    expect(called).toBe(false)
    expect(listRequests.count).toBe(0)
    expect(idsOf(store)).toEqual(itemsBefore)
  })

  it('[DSS-23] 送信中は changing が立ち、一覧の loading は立たない', async () => {
    const raw = dreamOrders.find((row) => row.Dream状況 === '9')
    server.use(
      http.put(CHANGE_PATH, async () => {
        await delay(10)
        return HttpResponse.json({ success: true, order: raw, message: '' })
      }),
    )
    const store = useDreamStatusStore()
    await store.load()
    const order = registrationErrorIn(store)

    const pending = store.changeStatus({ order, status: '0' })
    expect(store.changing).toBe(true)
    expect(store.loading).toBe(false)

    await pending
    expect(store.changing).toBe(false)
  })

  it('[DSS-24] clearChangeError で changeError が消える', async () => {
    const store = useDreamStatusStore()
    await store.load()
    const order = { ...registrationErrorIn(store), updatedAt: '2000-01-01T00:00:00' }
    await store.changeStatus({ order, status: '0' })
    expect(store.changeError).not.toBeNull()

    store.clearChangeError()

    expect(store.changeError).toBeNull()
  })
})

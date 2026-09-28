import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { dreamOrders, dreamStatusCodes } from '@/mocks/fixtures/dreamStatus'
import { DREAM_STATUS_PAGE_SIZE } from '@/stores/dreamStatus'
import { formatDateTime, formatQuantity } from '@/utils/format'
import DreamStatusListView from './DreamStatusListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分けと「URL クエリが正」の単方向フロー、STS変更の導線を検証する。
 * エラー内容のポップアップと STS変更ダイアログは Teleport を stub して wrapper 内に描かせる。
 */
const PATH = '/orders/dream-status'
const LIST_PATH = '*/api/orders/dream-status'
const STATUSES_PATH = '*/api/orders/dream-status/statuses'

const PAGE_SIZE = DREAM_STATUS_PAGE_SIZE
const TOTAL = dreamOrders.length
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 実 API と同じ並び（作成日時の新しい順）。フィクスチャは ID の昇順で置かれている */
const sorted = [...dreamOrders].sort((a, b) => b.作成日時.localeCompare(a.作成日時))
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE, PAGE_SIZE * 2)
const idsMatching = (predicate) => sorted.filter(predicate).map((row) => `#${row.ID}`)

const head = sorted[0]
const registrationError = firstPage.find((row) => row.Dream状況 === '9')
const cancelError = firstPage.find((row) => row.Dream状況 === 'C9')
const withReceipt = firstPage.find((row) => row.受注番号 && row.Dream完了日時)
const withoutReceipt = firstPage.find((row) => !row.受注番号 && !row.Dream完了日時)

/** 列の位置（列見出しの並びに対応） */
const COL = { status: 0, change: 1, completedAt: 2, receipt: 3, id: 4, side: 9, quantity: 10 }

const errorHandler = (options) =>
  http.get(LIST_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const emptyHandler = () =>
  http.get(LIST_PATH, () => HttpResponse.json({ total: 0, limit: 50, offset: 0, orders: [] }))

const Page = { render: () => h('div') }

async function mountView({ query = {} } = {}) {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const wrapper = mount(DreamStatusListView, {
    global: {
      plugins: [createPinia(), router],
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/**
 * 操作 → router.push → queryKey の watch → 再取得 → 再描画 までを待つ。
 * 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const idsOf = (wrapper) => rows(wrapper).map((row) => row.findAll('td')[COL.id].text())
const countText = (wrapper) => byTestid(wrapper, 'dream-status-count').text()
const rowFor = (wrapper, id) =>
  rows(wrapper).find((row) => row.findAll('td')[COL.id].text() === `#${id}`)
const cellsFor = (wrapper, id) => rowFor(wrapper, id).findAll('td')
const optionsOf = (select) =>
  select.findAll('option').map((option) => ({
    value: option.element.value,
    label: option.text(),
  }))
const isShown = (element) => element.style.display !== 'none'

// シナリオ: docs/unit/views-dream-status-list-view.md
describe('DreamStatusListView', () => {
  it('[DSV-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'dream-status-loading')).toBe(true)
    expect(exists(wrapper, 'dream-status-table')).toBe(false)
    expect(exists(wrapper, 'dream-status-empty')).toBe(false)
    expect(exists(wrapper, 'dream-status-error')).toBe(false)
    // 確定前の件数を出すと、前回の値が新しい結果に見える
    expect(exists(wrapper, 'dream-status-count')).toBe(false)
  })

  it('[DSV-02] 取得に失敗したときは理由と再試行を出す', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = byTestid(wrapper, 'dream-status-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'dream-status-table')).toBe(false)
    expect(exists(wrapper, 'dream-status-empty')).toBe(false)
  })

  it('[DSV-03] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(byTestid(wrapper, 'dream-status-empty').text()).toBe('該当する注文はありません。')
    expect(exists(wrapper, 'dream-status-table')).toBe(false)
  })

  it('[DSV-04] 件数と 1 ページぶんの行を出し、先頭がいちばん新しい注文になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    const first = rows(wrapper)[0]
    expect(first.findAll('td')[COL.id].text()).toBe(`#${head.ID}`)
    expect(first.text()).toContain(head.Dream状況名)
    expect(first.text()).toContain(head.顧客名)
    expect(first.text()).toContain(head.Ticker)
  })

  it('[DSV-05] 再試行で読み直すと表が出る', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await byTestid(wrapper, 'dream-status-error').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'dream-status-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[DSV-06] 列がモックの並びどおり 11 列で並ぶ', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.findAll('th').map((th) => th.text())).toEqual([
      'Dream登録状況',
      'STS変更',
      '登録日時',
      'Dream受付番号',
      '注文ID',
      '部店',
      '口座番号',
      '顧客名',
      '銘柄',
      '売買',
      '数量',
    ])
  })

  it('[DSV-07] 登録失敗・取消失敗の行だけにエラー内容のトリガがある', async () => {
    const { wrapper } = await mountView()
    await settle()

    const expected = firstPage.map((row) => ['9', 'C9'].includes(row.Dream状況))
    const actual = rows(wrapper).map((row) =>
      row.find('[data-testid="dream-status-error-trigger"]').exists(),
    )
    expect(actual).toEqual(expected)
    // 両方の行を含むフィクスチャでないと、このシナリオは意味を失う
    expect(expected).toContain(true)
    expect(expected).toContain(false)
  })

  it('[DSV-08] トリガにマウスを乗せると見出し付きでエラー内容が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    for (const [raw, title] of [
      [registrationError, 'Dream登録エラー詳細'],
      [cancelError, 'Dream取消エラー詳細'],
    ]) {
      // 開閉の前後で要素を取り直す（teleport の stub 下では、開閉の前後で本文の要素が同一とは限らない）
      const popoverOf = () =>
        cellsFor(wrapper, raw.ID)[COL.status].find('[data-testid="dream-status-error-popover"]')
      expect(isShown(popoverOf().element)).toBe(false)

      await cellsFor(wrapper, raw.ID)
        [COL.status].find('[data-testid="dream-status-error-trigger"]')
        .trigger('mouseenter')
      await flushPromises()

      const popover = popoverOf()
      expect(isShown(popover.element)).toBe(true)
      expect(popover.element.firstElementChild.textContent).toBe(title)
      expect(popover.text()).toContain(raw.Dreamエラー内容)
    }
  })

  it('[DSV-09] STS変更できる行だけプルダウンを出し、それ以外は「変更不可」', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 表の並びはフィクスチャの並び（作成日時の新しい順）と同じなので、位置で対応づける
    expect(idsOf(wrapper)).toEqual(firstPage.map((raw) => `#${raw.ID}`))
    const tableRows = rows(wrapper)

    for (const [index, raw] of firstPage.entries()) {
      const cell = tableRows[index].findAll('td')[COL.change]
      const select = cell.find('[data-testid="dream-status-change"]')
      const locked = cell.find('[data-testid="dream-status-locked"]')

      if (raw.STS変更可) {
        expect(locked.exists()).toBe(false)
        expect(select.attributes('aria-label')).toBe(`注文ID #${raw.ID} のSTS変更`)
        expect(optionsOf(select)).toEqual([
          { value: '', label: raw.Dream状況名 },
          ...raw.変更可能状況.map((t) => ({ value: t.コード, label: t.名称 })),
        ])
      } else {
        expect(select.exists()).toBe(false)
        expect(locked.text()).toBe('変更不可')
      }
    }
    expect(firstPage.some((raw) => raw.STS変更可)).toBe(true)
  })

  it('[DSV-10] プルダウンで遷移先を選ぶと確認ダイアログが開く', async () => {
    const target = registrationError.変更可能状況[0]
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'dream-status-change-dialog')).toBe(false)

    await cellsFor(wrapper, registrationError.ID)
      [COL.change].find('[data-testid="dream-status-change"]')
      .setValue(target.コード)

    const summary = byTestid(wrapper, 'dream-status-change-summary')
    expect(exists(wrapper, 'dream-status-change-dialog')).toBe(true)
    expect(summary.text()).toContain(`#${registrationError.ID}`)
    expect(summary.text()).toContain(target.名称)
  })

  it('[DSV-11] キャンセルするとダイアログが閉じてプルダウンが戻る', async () => {
    const target = registrationError.変更可能状況[0]
    const { wrapper } = await mountView()
    await settle()
    const selectOf = () =>
      cellsFor(wrapper, registrationError.ID)[COL.change].find(
        '[data-testid="dream-status-change"]',
      )

    await selectOf().setValue(target.コード)
    expect(selectOf().element.value).toBe(target.コード)

    await byTestid(wrapper, 'dream-status-change-cancel').trigger('click')

    expect(exists(wrapper, 'dream-status-change-dialog')).toBe(false)
    // 空値の先頭項目（いまの状況の表示）に戻り、選んだ遷移先が残らない
    expect(selectOf().element.value).toBe('')
  })

  it('[DSV-12] 検索すると URL に条件が乗り絞り込まれる', async () => {
    const expected = idsMatching(
      (row) =>
        row.部店 === head.部店 &&
        row.口座番号 === head.口座番号 &&
        row.Ticker === head.Ticker &&
        row.Dream状況 === head.Dream状況,
    )
    const { wrapper, router } = await mountView()
    await settle()

    await byTestid(wrapper, 'dream-status-branch-code').setValue(head.部店)
    await byTestid(wrapper, 'dream-status-account-number').setValue(String(head.口座番号))
    await byTestid(wrapper, 'dream-status-symbol').setValue(head.Ticker)
    await byTestid(wrapper, 'dream-status-status').setValue(head.Dream状況)
    await byTestid(wrapper, 'dream-status-search').trigger('submit')
    await settle()

    // 条件を変えたら 1 ページ目に戻すので offset は付かない
    expect(router.currentRoute.value.query).toEqual({
      branch_code: head.部店,
      account_number: String(head.口座番号),
      symbol: head.Ticker,
      dream_status: head.Dream状況,
    })
    expect(idsOf(wrapper)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('[DSV-13] URL の状況と登録日の条件が入力欄と一覧に反映される', async () => {
    const date = head.作成日時.slice(0, 10)
    const expected = idsMatching(
      (row) => ['9', 'C9'].includes(row.Dream状況) && row.作成日時.slice(0, 10) === date,
    )
    const { wrapper } = await mountView({
      query: { dream_status: 'ERROR', registered_from: date, registered_to: date },
    })
    await settle()

    expect(byTestid(wrapper, 'dream-status-status').element.value).toBe('ERROR')
    expect(byTestid(wrapper, 'dream-status-date-from').element.value).toBe(date)
    expect(byTestid(wrapper, 'dream-status-date-to').element.value).toBe(date)
    expect(idsOf(wrapper)).toEqual(expected)
    // ERROR だけで絞るより狭くなっている（日付が効いている）こと
    expect(expected.length).toBeLessThan(
      idsMatching((row) => ['9', 'C9'].includes(row.Dream状況)).length,
    )
  })

  it('[DSV-14] 受付番号で検索すると URL に dream_ref が乗り 1 件になる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await byTestid(wrapper, 'dream-status-receipt-number').setValue(withReceipt.受注番号)
    await byTestid(wrapper, 'dream-status-search').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ dream_ref: withReceipt.受注番号 })
    expect(idsOf(wrapper)).toEqual([`#${withReceipt.ID}`])
  })

  it('[DSV-15] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ query: { dream_status: 'ERROR' } })
    await settle()
    expect(rows(wrapper).length).toBeLessThan(PAGE_SIZE)

    await byTestid(wrapper, 'dream-status-search-clear').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(byTestid(wrapper, 'dream-status-status').element.value).toBe('')
  })

  it('[DSV-16] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="pagination-page"][data-page="2"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query.offset).toBe(String(PAGE_SIZE))
    expect(idsOf(wrapper)).toEqual(secondPage.map((row) => `#${row.ID}`))
  })

  it('[DSV-17] Dream登録状況の選択肢はコード一覧の並びどおり', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(optionsOf(byTestid(wrapper, 'dream-status-status'))).toEqual([
      { value: '', label: '-- 全て --' },
      ...dreamStatusCodes.map((raw) => ({ value: raw.コード, label: raw.名称 })),
    ])
  })

  it('[DSV-18] 値の無いセルは — を出し、ある値は整形して出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    const empty = cellsFor(wrapper, withoutReceipt.ID)
    expect(empty[COL.receipt].text()).toBe('—')
    expect(empty[COL.completedAt].text()).toBe('—')

    const filled = cellsFor(wrapper, withReceipt.ID)
    expect(filled[COL.receipt].text()).toBe(withReceipt.受注番号)
    expect(filled[COL.completedAt].text()).toBe(formatDateTime(withReceipt.Dream完了日時))
    expect(filled[COL.id].text()).toBe(`#${withReceipt.ID}`)
    expect(filled[COL.side].text()).toBe(withReceipt.売買区分名)
    expect(filled[COL.quantity].text()).toBe(formatQuantity(withReceipt.数量))
  })

  it('[DSV-19] 状況コードの取得中は検索カードが回転マークを出して検索を止める', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'dream-status-options-loading')).toBe(true)
    expect(byTestid(wrapper, 'dream-status-search-submit').element.disabled).toBe(true)

    await settle()

    expect(exists(wrapper, 'dream-status-options-loading')).toBe(false)
    expect(byTestid(wrapper, 'dream-status-search-submit').element.disabled).toBe(false)
  })

  it('[DSV-20] 状況コードの取得に失敗しても一覧は出て、選択肢は既定だけになる', async () => {
    server.use(
      http.get(STATUSES_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
    expect(optionsOf(byTestid(wrapper, 'dream-status-status'))).toEqual([
      { value: '', label: '-- 全て --' },
    ])
    expect(byTestid(wrapper, 'dream-status-status-field').text()).toContain(
      `Dream登録状況の選択肢を取得できませんでした（${ERROR_MESSAGE}）`,
    )
  })

  it('[DSV-21] 画面の説明と検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler()]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'dream-status-description')).toBe(true)
      expect(exists(wrapper, 'dream-status-search')).toBe(true)
      wrapper.unmount()
    }
  })
})

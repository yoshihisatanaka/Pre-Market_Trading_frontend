import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { balanceAdjustments } from '@/mocks/fixtures/balanceAdjustments'
import { customers } from '@/mocks/fixtures/customers'
import { BALANCE_ADJUSTMENTS_PAGE_SIZE } from '@/stores/balanceAdjustments'
import { useCodesStore } from '@/stores/codes'
import { CUSTOMER_OPTIONS_LIMIT } from '@/stores/customerOptions'
import {
  SPECIFIC_DEPOSIT_DEFAULT,
  SPECIFIC_DEPOSIT_OPTIONS,
  formatSpecificDeposit,
} from '@/utils/balanceTypes'
import { formatMonthDayTime, formatQuantity, joinWide } from '@/utils/format'
import BalanceAdjustmentListView from './BalanceAdjustmentListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分けと「URL クエリが正」の単方向フロー、セルの整形を検証する。
 *
 * この画面はコードマスタを自分では読み込まない（main.js が起動時に 1 回だけ読む）ので、
 * 部店のプルダウンを操作するテストだけ、マウント前に codes ストアを読み込んでおく。
 */
const PATH = '/masters/balance-adjustments'

// 期待値はフィクスチャと表示件数から導く（件数を直接書かない）
const PAGE_SIZE = BALANCE_ADJUSTMENTS_PAGE_SIZE
const TOTAL = balanceAdjustments.length

/** 既定ハンドラと同じ並び（口座番号 → 銘柄コード の昇順）。フィクスチャは生成順のまま */
const sorted = [...balanceAdjustments].sort(
  (a, b) => a.口座番号 - b.口座番号 || a.銘柄コード.localeCompare(b.銘柄コード),
)
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE, PAGE_SIZE * 2)

/** 検索条件は並びの先頭の行からそのまま取る（値を直接書かない） */
const HEAD = sorted[0]
const SEARCH = {
  branchCode: HEAD.部店コード,
  accountNumber: String(HEAD.口座番号),
  customerName: HEAD.顧客名,
  ticker: HEAD.Ticker,
  symbolName: HEAD.銘柄名,
}

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 一覧の応答の形 */
const listBody = (balances, total = balances.length) => ({
  total,
  limit: PAGE_SIZE,
  offset: 0,
  balances,
})

const errorHandler = (options) =>
  http.get(
    '*/api/masters/balance-adjustments',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const listHandler = (balances) =>
  http.get('*/api/masters/balance-adjustments', () => HttpResponse.json(listBody(balances)))

/**
 * 一覧の取得を握るハンドラ。解放するまで応答しない。
 *
 * @returns {() => void} 呼ぶと応答が返る
 */
function gateListResponse() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get('*/api/masters/balance-adjustments', async () => {
      await gate
      return HttpResponse.json(listBody([]))
    }),
  )
  return release
}

const Page = { render: () => h('div') }

/**
 * 画面をマウントする。
 *
 * @param {{ query?: object, withCodes?: boolean }} [options]
 *   withCodes を立てるとコードマスタを先に読み込む（部店のプルダウンに選択肢が入る）
 */
async function mountView({ query = {}, withCodes = false } = {}) {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する。
  // この画面が見るのは route.query だけ（見出しは AppHeader が meta.title から出す）
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  // mount 前に遷移を済ませておけば router.isReady() を待たなくてよい
  await router.push({ path: PATH, query })

  const pinia = createPinia()
  if (withCodes) {
    setActivePinia(pinia)
    await useCodesStore().load()
  }

  const wrapper = mount(BalanceAdjustmentListView, {
    global: {
      plugins: [pinia, router],
      // teleport を stub して、ヘッダへ差し込むボタンを wrapper 内に描画させる
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

const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const rangeText = (wrapper) => wrapper.find('[data-testid="pagination-range"]').text()
const countText = (wrapper) => wrapper.find('[data-testid="balance-adjustments-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const input = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)
/** 見出しの文言から列を引き、各行のそのセルを返す（列の並びを直接書かない） */
const cellsOf = (wrapper, label) => {
  const index = headers(wrapper).indexOf(label)
  return rows(wrapper).map((row) => row.findAll('td')[index])
}
/** 行が出しているティッカー（Ticker が無ければ銘柄コード） */
const tickerOf = (raw) => raw.Ticker || raw.銘柄コード

/* ------------------------------------------------------------------ *
 * 数量の加算（BLV-14〜26）
 * ------------------------------------------------------------------ */
const UPDATE_PATH = '*/api/masters/balance-adjustments/:id'

/**
 * 加算の対象行。取得時の更新日時が合札として送られることを見たいので、
 * 1 ページ目のうち更新日時を持つ行を選ぶ（値を直接書かない）
 */
const TARGET = firstPage.find((raw) => raw.更新日時)
/** 失敗後に開き直す別の行 */
const OTHER = firstPage.find((raw) => raw.ID !== TARGET.ID)
const BEFORE = TARGET.残高
/** 入力する加算数量（操作の入力値。期待値はここと補正前から導く） */
const ADDED = 50
const AFTER = BEFORE + ADDED

const CONFLICT_MESSAGE =
  '他のユーザーによって残高データが更新されています。最新データを再取得してください。'

const conflictHandler = () =>
  http.put(UPDATE_PATH, () => HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 }))

/**
 * 更新の呼び出しを数え、本文を記録するハンドラ。
 * respond を渡さなければ何も返さず既定ハンドラへ落とす（本文は読まない）
 *
 * @param {{ respond?: boolean }} [options] respond を立てると本文を読んで成功を返す
 */
function spyUpdate({ respond = false } = {}) {
  const calls = []
  server.use(
    http.put(UPDATE_PATH, async ({ request, params }) => {
      if (!respond) {
        calls.push({ id: params.id, body: null })
        return undefined
      }
      const body = await request.json()
      calls.push({ id: params.id, body })
      return HttpResponse.json({ success: true, balance: { ...TARGET, 残高: body.残高 } })
    }),
  )
  return calls
}

/** 更新の応答を握る。解放するまで応答しない */
function gateUpdateResponse() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.put(UPDATE_PATH, async () => {
      await gate
      return HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 })
    }),
  )
  return release
}

/** 項目の直下に出ているエラー（aria-describedby で紐づいた role="alert"） */
const fieldError = (wrapper, el) => {
  const ids = (el.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((node) => node.exists())
  return found ? found.text() : ''
}

const quantityInput = (wrapper) => input(wrapper, 'balance-adjustments-increase-quantity')
const openIncrease = (wrapper, raw) =>
  wrapper.find(`[data-testid="balance-adjustments-increase-${raw.ID}"]`).trigger('click')
const clickIncrease = (wrapper, part) =>
  wrapper.find(`[data-testid="balance-adjustments-increase-${part}"]`).trigger('click')

/** 一覧を出し、TARGET の加算モーダルを開き、数量を入れて確認ステップまで進める */
async function openConfirm({ quantity = String(ADDED) } = {}) {
  const mounted = await mountView()
  await settle()
  await openIncrease(mounted.wrapper, TARGET)
  await quantityInput(mounted.wrapper).setValue(quantity)
  await clickIncrease(mounted.wrapper, 'next')
  return mounted
}

/* ------------------------------------------------------------------ *
 * 新規保有を追加（BLV-27〜35）
 * ------------------------------------------------------------------ */
const CREATE_PATH = '*/api/masters/balance-adjustments'
const CUSTOMERS_PATH = '*/api/masters/customers'

/** 対象顧客のプルダウンに並ぶ顧客。既定ハンドラと同じ並び（口座番号の昇順・有効な行だけ） */
const sortedCustomers = customers
  .filter((raw) => raw.取消区分 === 0)
  .sort((a, b) => a.口座番号 - b.口座番号)
  .slice(0, CUSTOMER_OPTIONS_LIMIT)
/** 追加の対象顧客。プルダウンの先頭を選ぶ */
const CUSTOMER = sortedCustomers[0]
/** 選択肢の value（部店コードと口座番号の複合キー） */
const CUSTOMER_VALUE = `${CUSTOMER.部店コード}-${CUSTOMER.口座番号}`

/**
 * 入力するティッカー。大文字化を見たいので小文字で入れる（操作の入力値）。
 * 既存の保有と重複すると 400 になるので、フィクスチャに無い銘柄にしておく
 */
const NEW_TICKER = 'newco'
const NEW_SYMBOL_CODE = NEW_TICKER.toUpperCase()
const NEW_SYMBOL_NAME = 'NewCo Inc.'
/** 口座区分は既定（特定）以外を選び、選んだ値が送られることを見る */
const NEW_DEPOSIT = SPECIFIC_DEPOSIT_OPTIONS.find(
  (option) => option.value !== SPECIFIC_DEPOSIT_DEFAULT,
).value
/** 入力する加算数量（新規なので補正後と同じ値になる） */
const NEW_QUANTITY = 100

const DUPLICATE_MESSAGE = '同じ口座・銘柄・口座区分の残高が既に登録されています'

const addInput = (wrapper, part) => input(wrapper, `balance-adjustments-add-${part}`)
const clickAdd = (wrapper, part) =>
  wrapper.find(`[data-testid="balance-adjustments-add-${part}"]`).trigger('click')
const openAdd = (wrapper) =>
  wrapper.find('[data-testid="balance-adjustments-add"]').trigger('click')

/** 追加モーダルの 5 項目を埋める */
async function fillAdd(wrapper) {
  await addInput(wrapper, 'customer').setValue(CUSTOMER_VALUE)
  await addInput(wrapper, 'ticker').setValue(NEW_TICKER)
  await addInput(wrapper, 'symbol-name').setValue(NEW_SYMBOL_NAME)
  await addInput(wrapper, 'deposit').setValue(NEW_DEPOSIT)
  await addInput(wrapper, 'quantity').setValue(String(NEW_QUANTITY))
}

/** 一覧と顧客の選択肢を出し、追加モーダルを開き、入力して確認ステップまで進める */
async function openAddConfirm() {
  const mounted = await mountView()
  await settle()
  await openAdd(mounted.wrapper)
  await fillAdd(mounted.wrapper)
  await clickAdd(mounted.wrapper, 'next')
  return mounted
}

/** 登録の本文を記録し、送られた内容から組んだ 1 件を 201 で返すハンドラ */
function spyCreate() {
  const calls = []
  server.use(
    http.post(CREATE_PATH, async ({ request }) => {
      const body = await request.json()
      calls.push(body)
      return HttpResponse.json(
        { success: true, balance: { ...sorted[0], ...body, ID: TOTAL + 1000 } },
        { status: 201 },
      )
    }),
  )
  return calls
}

/** 顧客一覧の取得を握る。解放するまで応答しない */
function gateCustomersResponse() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get(CUSTOMERS_PATH, async () => {
      await gate
      return HttpResponse.json({ total: 0, limit: CUSTOMER_OPTIONS_LIMIT, offset: 0, customers: [] })
    }),
  )
  return release
}

/* ------------------------------------------------------------------ *
 * 売却の停止 / 解除（BLV-36〜43）
 * ------------------------------------------------------------------ */

/**
 * 売却可の行。取得時の更新日時が合札として送られることを見たいので、
 * 1 ページ目のうち更新日時を持つ売却可の行を選ぶ（値を直接書かない）
 */
const SELLABLE = firstPage.find((raw) => raw.売却不可区分 === 0 && raw.更新日時)
/** 売却不可の行。1 ページ目からフィクスチャで探す */
const PROHIBITED = firstPage.find((raw) => raw.売却不可区分 === 1)

const openSell = (wrapper, raw) =>
  wrapper.find(`[data-testid="balance-adjustments-sell-${raw.ID}"]`).trigger('click')
const clickSell = (wrapper, part) =>
  wrapper.find(`[data-testid="balance-adjustments-sell-${part}"]`).trigger('click')
const sellMessage = (wrapper) => wrapper.find('[data-testid="balance-adjustments-sell-message"]')

/** 売却可否の更新の本文を記録し、送られた区分に書き換えた 1 件を返すハンドラ */
function spySell(raw) {
  const calls = []
  server.use(
    http.put(UPDATE_PATH, async ({ request, params }) => {
      const body = await request.json()
      calls.push({ id: params.id, body })
      return HttpResponse.json({
        success: true,
        balance: { ...raw, 売却不可区分: body.売却不可区分 },
      })
    }),
  )
  return calls
}

/** 一覧を出し、指定の行の売却可否の確認ダイアログを開く */
async function openSellConfirm(raw) {
  const mounted = await mountView()
  await settle()
  await openSell(mounted.wrapper, raw)
  return mounted
}

// シナリオ: docs/unit/views-balance-adjustment-list-view.md
describe('BalanceAdjustmentListView', () => {
  describe('一覧の 4 状態', () => {
    it('[BLV-01] 取得中はローディングを表示し、表は出さない', async () => {
      // watch(immediate) は setup 中に同期で走るが、応答を握って取得中のまま止めておく
      const release = gateListResponse()
      const { wrapper } = await mountView()
      await flushPromises()

      expect(exists(wrapper, 'balance-adjustments-loading')).toBe(true)
      expect(exists(wrapper, 'balance-adjustments-table')).toBe(false)

      release()
      await settle()
    })

    it('[BLV-02] 取得成功時は 1 ページ目と件数・ページャーを表示する', async () => {
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'balance-adjustments-loading')).toBe(false)
      expect(rows(wrapper)).toHaveLength(firstPage.length)
      expect(countText(wrapper)).toBe(`${TOTAL} 件`)
      expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 1–${PAGE_SIZE} 件`)
      expect(rows(wrapper)[0].text()).toContain(tickerOf(firstPage[0]))
    })

    it('[BLV-03] API がエラーを返したときはメッセージと再試行ボタンを表示する', async () => {
      server.use(errorHandler())
      const { wrapper } = await mountView()
      await settle()

      const error = wrapper.find('[data-testid="balance-adjustments-error"]')
      expect(error.exists()).toBe(true)
      expect(error.text()).toContain(ERROR_MESSAGE)
      expect(error.find('button').text()).toBe('再試行')
      expect(exists(wrapper, 'balance-adjustments-table')).toBe(false)
    })

    it('[BLV-04] 残高が 0 件のときは空状態を表示し、表もページャーも出さない', async () => {
      server.use(listHandler([]))
      const { wrapper } = await mountView()
      await settle()

      const empty = wrapper.find('[data-testid="balance-adjustments-empty"]')
      expect(empty.exists()).toBe(true)
      expect(empty.text()).toBe('条件に一致する保有残高がありません。')
      expect(exists(wrapper, 'balance-adjustments-table')).toBe(false)
      expect(exists(wrapper, 'balance-adjustments-pagination')).toBe(false)
    })

    it('[BLV-05] エラーのときも検索フォームは消えず、条件を入れ直せる', async () => {
      server.use(errorHandler())
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'balance-adjustments-error')).toBe(true)
      expect(exists(wrapper, 'balance-adjustments-search')).toBe(true)

      const ticker = input(wrapper, 'balance-adjustments-ticker')
      await ticker.setValue(SEARCH.ticker)
      expect(ticker.element.value).toBe(SEARCH.ticker)
      expect(input(wrapper, 'balance-adjustments-search-submit').attributes('disabled')).toBe(
        undefined,
      )
    })
  })

  describe('ページ位置と検索条件（URL クエリ）', () => {
    it('[BLV-06] offset 付きの URL で開くと 2 ページ目を表示する', async () => {
      const { wrapper } = await mountView({ query: { offset: String(PAGE_SIZE) } })
      await settle()

      expect(rows(wrapper)).toHaveLength(secondPage.length)
      expect(rows(wrapper)[0].text()).toContain(tickerOf(secondPage[0]))
      expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`)
    })

    it('[BLV-07] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
      const { wrapper, router } = await mountView()
      await settle()

      await pageButton(wrapper, 2).trigger('click')
      await settle()

      expect(router.currentRoute.value.query).toEqual({ offset: String(PAGE_SIZE) })
      expect(rows(wrapper)).toHaveLength(secondPage.length)
      expect(rows(wrapper)[0].text()).toContain(tickerOf(secondPage[0]))
    })

    it('[BLV-08] 検索条件 5 項目を入れて検索すると URL クエリに 5 つとも乗る', async () => {
      const { wrapper, router } = await mountView({ withCodes: true })
      await settle()

      await input(wrapper, 'balance-adjustments-branch-code').setValue(SEARCH.branchCode)
      await input(wrapper, 'balance-adjustments-account-number').setValue(SEARCH.accountNumber)
      await input(wrapper, 'balance-adjustments-customer-name').setValue(SEARCH.customerName)
      await input(wrapper, 'balance-adjustments-ticker').setValue(SEARCH.ticker)
      await input(wrapper, 'balance-adjustments-symbol-name').setValue(SEARCH.symbolName)
      await wrapper.find('[data-testid="balance-adjustments-search"]').trigger('submit')
      await settle()

      expect(router.currentRoute.value.query).toEqual({
        branch_code: SEARCH.branchCode,
        account_no: SEARCH.accountNumber,
        customer_name: SEARCH.customerName,
        symbol: SEARCH.ticker,
        symbol_name: SEARCH.symbolName,
      })
      // 条件を作った先頭の行は必ず残る
      expect(rows(wrapper).length).toBeGreaterThan(0)
      expect(rows(wrapper)[0].text()).toContain(tickerOf(HEAD))
    })

    it('[BLV-09] クリアで URL クエリが空になり全件の 1 ページ目に戻る', async () => {
      const { wrapper, router } = await mountView({ query: { symbol: SEARCH.ticker } })
      await settle()
      expect(countText(wrapper)).not.toBe(`${TOTAL} 件`)

      await wrapper.find('[data-testid="balance-adjustments-search-clear"]').trigger('click')
      await settle()

      expect(router.currentRoute.value.query).toEqual({})
      expect(rows(wrapper)).toHaveLength(firstPage.length)
      expect(countText(wrapper)).toBe(`${TOTAL} 件`)
      expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 1–${PAGE_SIZE} 件`)
    })

    it('[BLV-10] URL の symbol がティッカーの入力欄に反映される', async () => {
      const { wrapper } = await mountView({ query: { symbol: SEARCH.ticker } })
      await settle()

      expect(input(wrapper, 'balance-adjustments-ticker').element.value).toBe(SEARCH.ticker)
    })

    it('[BLV-11] 「再試行」で同じ条件のまま読み直し、URL クエリは変わらない', async () => {
      // 初回だけ失敗させ、再試行は既定ハンドラに応えさせる
      server.use(errorHandler({ once: true }))
      const query = { offset: String(PAGE_SIZE) }
      const { wrapper, router } = await mountView({ query })
      await settle()
      expect(exists(wrapper, 'balance-adjustments-error')).toBe(true)

      await wrapper.find('[data-testid="balance-adjustments-error"] button').trigger('click')
      await settle()

      expect(router.currentRoute.value.query).toEqual(query)
      expect(exists(wrapper, 'balance-adjustments-error')).toBe(false)
      // 同じ offset で読み直しているので、2 ページ目が出る
      expect(rows(wrapper)).toHaveLength(secondPage.length)
      expect(rows(wrapper)[0].text()).toContain(tickerOf(secondPage[0]))
    })
  })

  describe('セルの表示', () => {
    it('[BLV-12] 更新日時のある行は日時と更新者の 2 段、無い行は「—」。前者だけ手動補正の印が付く', async () => {
      // フィクスチャから「補正済みの行」と「取込のままの行」を 1 件ずつ取る
      const modified = sorted.find((raw) => raw.更新日時 && raw.更新者)
      const plain = sorted.find((raw) => !raw.更新日時 && raw.ユーザー操作フラグ === 0)
      server.use(listHandler([modified, plain]))
      const { wrapper } = await mountView()
      await settle()

      const [modifiedCell, plainCell] = cellsOf(wrapper, '最終更新')
      // コードマスタ未読み込みなので、更新者はコードのまま出る
      const lines = modifiedCell.findAll('span').map((span) => span.text())
      expect(lines).toEqual([formatMonthDayTime(modified.更新日時), modified.更新者])
      expect(plainCell.text()).toBe('—')

      const [modifiedRow, plainRow] = rows(wrapper)
      expect(modifiedRow.classes()).toContain('is-user-modified')
      expect(plainRow.classes()).not.toContain('is-user-modified')
    })

    it('[BLV-13] 特定預り区分名が空の行は、口座区分セルがフロントの対応表の名前になる', async () => {
      // 区分ごとに 1 行ずつ、表示名を落としてコードだけにする
      const base = sorted[0]
      const nameless = SPECIFIC_DEPOSIT_OPTIONS.map((option, index) => ({
        ...base,
        ID: base.ID + index,
        特定預り区分: option.value,
        特定預り区分名: null,
        預り区分名: null,
      }))
      server.use(listHandler(nameless))
      const { wrapper } = await mountView()
      await settle()

      expect(cellsOf(wrapper, '口座区分').map((cell) => cell.text())).toEqual(
        SPECIFIC_DEPOSIT_OPTIONS.map((option) => option.label),
      )
    })
  })

  describe('数量を加算（入力ステップ）', () => {
    it('[BLV-14] 「数量を加算」で対象顧客・銘柄・口座区分が読み取り専用で出て、加算数量は空', async () => {
      const { wrapper } = await mountView()
      await settle()

      await openIncrease(wrapper, TARGET)

      expect(exists(wrapper, 'balance-adjustments-increase-form')).toBe(true)
      const customer = input(wrapper, 'balance-adjustments-increase-customer')
      const symbol = input(wrapper, 'balance-adjustments-increase-symbol')
      const deposit = input(wrapper, 'balance-adjustments-increase-deposit')
      expect(customer.text()).toBe(`${TARGET.顧客名 || '—'}（${TARGET.口座番号}）`)
      expect(symbol.text()).toBe(joinWide(tickerOf(TARGET), TARGET.銘柄名 ?? '').trim())
      expect(deposit.text()).toBe(
        (TARGET.特定預り区分名 ?? TARGET.預り区分名) || formatSpecificDeposit(TARGET.特定預り区分),
      )
      // 読み取り専用 = 入力欄ではない
      for (const el of [customer, symbol, deposit]) {
        expect(['INPUT', 'SELECT', 'TEXTAREA']).not.toContain(el.element.tagName)
      }
      expect(quantityInput(wrapper).element.value).toBe('')
    })

    it('[BLV-15] 加算数量を入れると集計パネルの加算数量と補正後数量が追従する', async () => {
      const { wrapper } = await mountView()
      await settle()
      await openIncrease(wrapper, TARGET)

      await quantityInput(wrapper).setValue(String(ADDED))

      expect(input(wrapper, 'balance-adjustments-increase-before').text()).toBe(
        `${formatQuantity(BEFORE)}株`,
      )
      expect(input(wrapper, 'balance-adjustments-increase-added').text()).toBe(
        `+${formatQuantity(ADDED)}株`,
      )
      expect(input(wrapper, 'balance-adjustments-increase-after').text()).toBe(
        `${formatQuantity(AFTER)}株`,
      )
    })

    it('[BLV-16] 数値でない加算数量のあいだは加算数量が「—」、補正後数量は補正前のまま', async () => {
      const { wrapper } = await mountView()
      await settle()
      await openIncrease(wrapper, TARGET)

      await quantityInput(wrapper).setValue('abc')

      expect(input(wrapper, 'balance-adjustments-increase-added').text()).toBe('—')
      expect(input(wrapper, 'balance-adjustments-increase-after').text()).toBe(
        `${formatQuantity(BEFORE)}株`,
      )
    })

    it('[BLV-17] 未入力で「内容を確認」を押すと項目の直下にエラーが出て、確認に進まず API も呼ばない', async () => {
      const calls = spyUpdate()
      const { wrapper } = await mountView()
      await settle()
      await openIncrease(wrapper, TARGET)

      await clickIncrease(wrapper, 'next')
      await settle()

      expect(fieldError(wrapper, quantityInput(wrapper))).not.toBe('')
      expect(exists(wrapper, 'balance-adjustments-increase-confirm')).toBe(false)
      expect(calls).toHaveLength(0)
    })

    it('[BLV-18] 加算数量 0 は「0 は指定できません」のエラーになる', async () => {
      const { wrapper } = await mountView()
      await settle()
      await openIncrease(wrapper, TARGET)

      await quantityInput(wrapper).setValue('0')
      await clickIncrease(wrapper, 'next')

      expect(fieldError(wrapper, quantityInput(wrapper))).toContain('0 は指定できません')
      expect(exists(wrapper, 'balance-adjustments-increase-confirm')).toBe(false)
    })

    it('[BLV-19] 補正後が負になる加算数量は「補正後数量が負になります」のエラーになる', async () => {
      const { wrapper } = await mountView()
      await settle()
      await openIncrease(wrapper, TARGET)

      // 補正前より 1 株多く減らす
      await quantityInput(wrapper).setValue(String(-(BEFORE + 1)))
      await clickIncrease(wrapper, 'next')

      expect(fieldError(wrapper, quantityInput(wrapper))).toContain('補正後数量が負になります')
      expect(exists(wrapper, 'balance-adjustments-increase-confirm')).toBe(false)
    })
  })

  describe('数量を加算（確認ステップと確定）', () => {
    it('[BLV-20] 有効な加算数量で「内容を確認」を押すと 8 行の確認ステップになり、API はまだ呼ばない', async () => {
      const calls = spyUpdate()
      const { wrapper } = await openConfirm()
      await settle()

      const confirm = wrapper.find('[data-testid="balance-adjustments-increase-confirm"]')
      expect(confirm.exists()).toBe(true)
      expect(confirm.findAll('dt').map((dt) => dt.text())).toEqual([
        '操作種別',
        '対象顧客',
        '対象銘柄',
        '口座区分',
        '補正前数量',
        '加算数量',
        '補正後数量',
        '更新者',
      ])
      const values = confirm.findAll('dd').map((dd) => dd.text())
      expect(values[4]).toBe(`${formatQuantity(BEFORE)}株`)
      expect(values[5]).toBe(`+${formatQuantity(ADDED)}株`)
      expect(values[6]).toBe(`${formatQuantity(AFTER)}株`)
      expect(calls).toHaveLength(0)
    })

    it('[BLV-21] 確認ステップの「戻る」で入力ステップに戻り、加算数量の入力が残る', async () => {
      const { wrapper } = await openConfirm()

      await clickIncrease(wrapper, 'back')

      expect(exists(wrapper, 'balance-adjustments-increase-confirm')).toBe(false)
      expect(exists(wrapper, 'balance-adjustments-increase-form')).toBe(true)
      expect(quantityInput(wrapper).element.value).toBe(String(ADDED))
    })

    it('[BLV-22] 「補正を確定」で残高に補正後の絶対値と取得時の更新日時が送られる', async () => {
      const calls = spyUpdate({ respond: true })
      const { wrapper } = await openConfirm()

      await clickIncrease(wrapper, 'submit')
      await settle()
      await settle()

      expect(calls).toHaveLength(1)
      expect(calls[0].id).toBe(String(TARGET.ID))
      // 加算数量（ADDED）ではなく補正後（BEFORE + ADDED）を送る
      expect(calls[0].body).toEqual({ 残高: AFTER, 更新日時: TARGET.更新日時 })
    })

    it('[BLV-23] 更新が成功するとモーダルが閉じ、成功メッセージが出て一覧が読み直される', async () => {
      const { wrapper } = await openConfirm()
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)

      await clickIncrease(wrapper, 'submit')
      // PUT → 一覧の再取得 → 再描画 の 2 往復を待つ
      await settle()
      await settle()

      expect(exists(wrapper, 'balance-adjustments-increase-form')).toBe(false)
      const notice = wrapper.find('[data-testid="balance-adjustments-notice"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain(tickerOf(TARGET))
      expect(notice.text()).toContain(`${formatQuantity(AFTER)}株`)
      // 読み直した一覧の対象行が補正後の数量になっている
      const index = firstPage.indexOf(TARGET)
      expect(cellsOf(wrapper, '現在数量')[index].text()).toBe(`${formatQuantity(AFTER)}株`)
    })

    it('[BLV-24] 更新が 409 のときはモーダルが開いたまま確認ステップに理由が出て、成功メッセージは出ない', async () => {
      server.use(conflictHandler())
      const { wrapper } = await openConfirm()

      await clickIncrease(wrapper, 'submit')
      await settle()

      expect(exists(wrapper, 'balance-adjustments-increase-confirm')).toBe(true)
      expect(wrapper.find('[data-testid="balance-adjustments-increase-error"]').text()).toContain(
        CONFLICT_MESSAGE,
      )
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)
    })

    it('[BLV-25] 更新の応答待ちのあいだは「戻る」を押してもモーダルが閉じない', async () => {
      const release = gateUpdateResponse()
      const { wrapper } = await openConfirm()

      await clickIncrease(wrapper, 'submit')
      await flushPromises()
      await clickIncrease(wrapper, 'back')
      await flushPromises()

      expect(exists(wrapper, 'balance-adjustments-increase-form')).toBe(true)
      expect(exists(wrapper, 'balance-adjustments-increase-confirm')).toBe(true)

      release()
      await settle()
    })

    it('[BLV-26] 409 の後に閉じて別の行を開くと、前回のエラーも加算数量も持ち込まれない', async () => {
      server.use(conflictHandler())
      const { wrapper } = await openConfirm()
      await clickIncrease(wrapper, 'submit')
      await settle()
      expect(exists(wrapper, 'balance-adjustments-increase-error')).toBe(true)

      // 確認の「戻る」で入力へ、入力の「戻る」でモーダルを閉じる
      await clickIncrease(wrapper, 'back')
      await clickIncrease(wrapper, 'back')
      expect(exists(wrapper, 'balance-adjustments-increase-form')).toBe(false)

      await openIncrease(wrapper, OTHER)

      expect(exists(wrapper, 'balance-adjustments-increase-form')).toBe(true)
      expect(exists(wrapper, 'balance-adjustments-increase-error')).toBe(false)
      expect(quantityInput(wrapper).element.value).toBe('')
    })
  })

  describe('新規保有を追加（入力ステップ）', () => {
    it('[BLV-27] 「新規保有を追加」で追加モーダルが開き、顧客は未選択・入力欄は空・口座区分は「特定」', async () => {
      const { wrapper } = await mountView()
      await settle()

      await openAdd(wrapper)

      expect(exists(wrapper, 'balance-adjustments-add-form')).toBe(true)
      expect(addInput(wrapper, 'customer').element.value).toBe('')
      expect(addInput(wrapper, 'ticker').element.value).toBe('')
      expect(addInput(wrapper, 'symbol-name').element.value).toBe('')
      expect(addInput(wrapper, 'quantity').element.value).toBe('')

      const deposit = addInput(wrapper, 'deposit').element
      expect(deposit.value).toBe(SPECIFIC_DEPOSIT_DEFAULT)
      expect(deposit.selectedOptions[0].textContent.trim()).toBe('特定')
    })

    it('[BLV-28] 未入力で「内容を確認」を押すと 4 項目それぞれの直下にエラーが出て、確認に進まない', async () => {
      const { wrapper } = await mountView()
      await settle()
      await openAdd(wrapper)

      await clickAdd(wrapper, 'next')

      for (const part of ['customer', 'ticker', 'symbol-name', 'quantity']) {
        expect(fieldError(wrapper, addInput(wrapper, part)), part).not.toBe('')
      }
      expect(exists(wrapper, 'balance-adjustments-add-confirm')).toBe(false)
    })

    it('[BLV-29] 加算数量 0 は「1 以上で入力してください」のエラーになる', async () => {
      const { wrapper } = await mountView()
      await settle()
      await openAdd(wrapper)

      await fillAdd(wrapper)
      await addInput(wrapper, 'quantity').setValue('0')
      await clickAdd(wrapper, 'next')

      expect(fieldError(wrapper, addInput(wrapper, 'quantity'))).toContain('1 以上で入力してください')
      expect(exists(wrapper, 'balance-adjustments-add-confirm')).toBe(false)
    })

    it('[BLV-30] 対象顧客の選択肢が「部店 / 口座番号　顧客名」の形で並ぶ', async () => {
      const { wrapper } = await mountView()
      await settle()

      await openAdd(wrapper)

      const labels = addInput(wrapper, 'customer')
        .findAll('option')
        .filter((option) => option.element.value !== '')
        .map((option) => option.text())
      expect(labels).toEqual(
        sortedCustomers.map((raw) => joinWide(`${raw.部店コード} / ${raw.口座番号}`, raw.顧客名)),
      )
    })

    it('[BLV-31] 顧客一覧の取得中は対象顧客の select が無効になっている', async () => {
      const release = gateCustomersResponse()
      const { wrapper } = await mountView()
      await settle()

      await openAdd(wrapper)

      expect(addInput(wrapper, 'customer').attributes('disabled')).toBeDefined()

      release()
      await settle()
    })
  })

  describe('新規保有を追加（確認ステップと確定）', () => {
    it('[BLV-32] 「補正を確定」で顧客の部店・口座番号、大文字のティッカー、口座区分、加算数量が送られ、銘柄名は送らない', async () => {
      const calls = spyCreate()
      const { wrapper } = await openAddConfirm()
      expect(exists(wrapper, 'balance-adjustments-add-confirm')).toBe(true)

      await clickAdd(wrapper, 'submit')
      await settle()
      await settle()

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        部店コード: CUSTOMER.部店コード,
        口座番号: CUSTOMER.口座番号,
        銘柄コード: NEW_SYMBOL_CODE,
        特定預り区分: NEW_DEPOSIT,
        残高: NEW_QUANTITY,
      })
    })

    it('[BLV-33] 追加が成功するとモーダルが閉じ、成功メッセージが出て一覧が読み直される', async () => {
      // 既定ハンドラの重複判定に掛からない銘柄であること
      expect(
        balanceAdjustments.some((raw) => raw.銘柄コード.toUpperCase() === NEW_SYMBOL_CODE),
      ).toBe(false)
      const { wrapper } = await openAddConfirm()
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)

      await clickAdd(wrapper, 'submit')
      // POST → 一覧の再取得 → 再描画 の 2 往復を待つ
      await settle()
      await settle()

      expect(exists(wrapper, 'balance-adjustments-add-form')).toBe(false)
      const notice = wrapper.find('[data-testid="balance-adjustments-notice"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain(NEW_SYMBOL_CODE)
      // 読み直した一覧に追加した 1 件が数えられている
      expect(countText(wrapper)).toBe(`${TOTAL + 1} 件`)
    })

    it('[BLV-34] 追加が 400（重複）のときはモーダルが開いたまま確認ステップに理由が出る', async () => {
      server.use(
        http.post(CREATE_PATH, () =>
          HttpResponse.json({ detail: DUPLICATE_MESSAGE }, { status: 400 }),
        ),
      )
      const { wrapper } = await openAddConfirm()

      await clickAdd(wrapper, 'submit')
      await settle()

      expect(exists(wrapper, 'balance-adjustments-add-confirm')).toBe(true)
      expect(wrapper.find('[data-testid="balance-adjustments-add-error"]').text()).toContain(
        DUPLICATE_MESSAGE,
      )
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)
    })

    it('[BLV-35] 成功メッセージが出ている状態で新たにモーダルを開くと、メッセージが消え説明文に戻る', async () => {
      const { wrapper } = await openAddConfirm()
      await clickAdd(wrapper, 'submit')
      await settle()
      await settle()
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(true)
      expect(exists(wrapper, 'balance-adjustments-description')).toBe(false)

      await openAdd(wrapper)

      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)
      expect(wrapper.find('[data-testid="balance-adjustments-description"]').text()).toContain(
        '既存保有への数量加算',
      )
    })
  })

  describe('売却の停止 / 解除', () => {
    it('[BLV-36] 売却不可の行はバッジ「売却不可」とボタン「売却停止を解除」、売却可の行は文字「売却可」とボタン「売却を停止」', async () => {
      server.use(listHandler([PROHIBITED, SELLABLE]))
      const { wrapper } = await mountView()
      await settle()

      const [prohibitedCell, sellableCell] = cellsOf(wrapper, '売却不可区分')
      expect(prohibitedCell.text()).toBe('売却不可')
      expect(sellableCell.text()).toBe('売却可')

      expect(wrapper.find(`[data-testid="balance-adjustments-sell-${PROHIBITED.ID}"]`).text()).toBe(
        '売却停止を解除',
      )
      expect(wrapper.find(`[data-testid="balance-adjustments-sell-${SELLABLE.ID}"]`).text()).toBe(
        '売却を停止',
      )
    })

    it('[BLV-37] 売却可の行で「売却を停止」を押すと停止の確認が開き、API はまだ呼ばない', async () => {
      const calls = spySell(SELLABLE)
      const { wrapper } = await openSellConfirm(SELLABLE)
      await settle()

      expect(sellMessage(wrapper).exists()).toBe(true)
      expect(sellMessage(wrapper).text()).toBe('売却を停止します。よろしいですか？')
      expect(calls).toHaveLength(0)
    })

    it('[BLV-38] 売却不可の行で「売却停止を解除」を押すと解除の確認が開く', async () => {
      const { wrapper } = await openSellConfirm(PROHIBITED)

      expect(sellMessage(wrapper).text()).toBe('売却停止を解除します。よろしいですか？')
    })

    it('[BLV-39] 売却可の行の確認で「OK」を押すと 売却不可区分 1 と取得時の更新日時だけが送られる', async () => {
      const calls = spySell(SELLABLE)
      const { wrapper } = await openSellConfirm(SELLABLE)

      await clickSell(wrapper, 'submit')
      await settle()
      await settle()

      expect(calls).toHaveLength(1)
      expect(calls[0].id).toBe(String(SELLABLE.ID))
      expect(calls[0].body).toEqual({ 売却不可区分: 1, 更新日時: SELLABLE.更新日時 })
    })

    it('[BLV-40] 売却不可の行の確認で「OK」を押すと 売却不可区分 0 が送られる', async () => {
      const calls = spySell(PROHIBITED)
      const { wrapper } = await openSellConfirm(PROHIBITED)

      await clickSell(wrapper, 'submit')
      await settle()
      await settle()

      expect(calls).toHaveLength(1)
      expect(calls[0].id).toBe(String(PROHIBITED.ID))
      expect(calls[0].body).toHaveProperty('売却不可区分', 0)
      expect(calls[0].body).not.toHaveProperty('残高')
    })

    it('[BLV-41] 切り替えが成功すると確認が閉じ、成功メッセージが出て一覧が読み直される', async () => {
      const { wrapper } = await openSellConfirm(SELLABLE)
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)

      await clickSell(wrapper, 'submit')
      // PUT → 一覧の再取得 → 再描画 の 2 往復を待つ
      await settle()
      await settle()

      expect(sellMessage(wrapper).exists()).toBe(false)
      const notice = wrapper.find('[data-testid="balance-adjustments-notice"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain(tickerOf(SELLABLE))
      // 読み直した一覧で対象行が売却不可に変わっている
      const index = firstPage.indexOf(SELLABLE)
      expect(cellsOf(wrapper, '売却不可区分')[index].text()).toBe('売却不可')
      expect(wrapper.find(`[data-testid="balance-adjustments-sell-${SELLABLE.ID}"]`).text()).toBe(
        '売却停止を解除',
      )
    })

    it('[BLV-42] 切り替えが 409 のときは確認が開いたまま理由が出て、成功メッセージは出ない', async () => {
      server.use(conflictHandler())
      const { wrapper } = await openSellConfirm(SELLABLE)

      await clickSell(wrapper, 'submit')
      await settle()

      expect(sellMessage(wrapper).exists()).toBe(true)
      expect(wrapper.find('[data-testid="balance-adjustments-sell-error"]').text()).toContain(
        CONFLICT_MESSAGE,
      )
      expect(exists(wrapper, 'balance-adjustments-notice')).toBe(false)
    })

    it('[BLV-43] 更新の応答待ちのあいだは「キャンセル」を押しても確認が閉じない', async () => {
      const release = gateUpdateResponse()
      const { wrapper } = await openSellConfirm(SELLABLE)

      await clickSell(wrapper, 'submit')
      await flushPromises()
      await clickSell(wrapper, 'cancel')
      await flushPromises()

      expect(sellMessage(wrapper).exists()).toBe(true)

      release()
      await settle()
    })
  })
})

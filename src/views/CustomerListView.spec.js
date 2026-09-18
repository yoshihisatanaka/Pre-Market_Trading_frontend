import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { codeMasters } from '@/mocks/fixtures/codes'
import { customers } from '@/mocks/fixtures/customers'
import { useCodesStore } from '@/stores/codes'
import { CUSTOMERS_PAGE_SIZE } from '@/stores/customers'
import CustomerListView from './CustomerListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 *
 * この画面はコードマスタを自分では読み込まない（main.js が起動時に 1 回だけ読む）ので、
 * プルダウンの中身を見るテストだけ、マウント前に codes ストアを読み込んでおく。
 *
 * シナリオ: docs/unit/views-customer-list-view.md
 */
const PATH = '/masters/customers'

const PAGE_SIZE = CUSTOMERS_PAGE_SIZE
const TOTAL = customers.length

/** 実 API と同じ並び（口座番号の昇順）。フィクスチャは生成順のまま置かれている */
const sorted = [...customers].sort((a, b) => a.口座番号 - b.口座番号)
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE)

const head = sorted[0]
const BRANCH_CODE = head.部店コード
const CUSTOMER_NAME = head.顧客名

/*
 * 金額の期待値。画面は単位を後置する（3,500,000 円 / 50,000.00 ドル）。
 * 値そのものはフィクスチャから取り、ここでは「形」だけを固定する。
 */
const jpyText = (value) => `${value.toLocaleString('ja-JP')} 円`
const usdText = (value) =>
  `${value.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ドル`

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 顧客一覧の応答の形 */
const listBody = (rows, total = rows.length) => ({ total, customers: rows })

const errorHandler = (options) =>
  http.get(
    '*/api/masters/customers',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/masters/customers', () => HttpResponse.json(listBody([])), options)

const Page = { render: () => h('div') }

/**
 * 画面をマウントする。
 *
 * @param {{ query?: object, withCodes?: boolean, pendingCodes?: boolean }} [options]
 *   withCodes を立てるとコードマスタを先に読み込む（プルダウンに選択肢が入る）。
 *   pendingCodes は読み込みを始めるだけで待たない（取得中の見た目を見るため）
 */
async function mountView({ query = {}, withCodes = false, pendingCodes = false } = {}) {
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
  if (withCodes || pendingCodes) {
    setActivePinia(pinia)
    const loaded = useCodesStore().load()
    // pendingCodes のときは待たない。main.js が起動時に読み始めた直後の状態を作る
    if (withCodes) await loaded
  }

  const wrapper = mount(CustomerListView, {
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
const countText = (wrapper) => wrapper.find('[data-testid="customers-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)
const optionsOf = (wrapper, testid) =>
  wrapper.findAll(`[data-testid="${testid}"] option`).map((option) => ({
    value: option.element.value,
    label: option.text(),
  }))

/** 口座番号（3 列目）で行を特定する。氏名は部店をまたいで重複するので使えない */
const rowFor = (wrapper, accountNumber) =>
  rows(wrapper).find((row) => row.findAll('td')[2].text() === String(accountNumber))

const cellsFor = (wrapper, accountNumber) => rowFor(wrapper, accountNumber).findAll('td')

describe('CustomerListView', () => {
  it('[CLV-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'customers-loading')).toBe(true)
    expect(exists(wrapper, 'customers-table')).toBe(false)
    expect(exists(wrapper, 'customers-empty')).toBe(false)
    // 確定前の件数を出すと、前回の値が新しい結果に見える
    expect(exists(wrapper, 'customers-count')).toBe(false)
  })

  it('[CLV-02] 1 ページ目の件数と行がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    const first = rows(wrapper)[0].text()
    expect(first).toContain(head.部店コード)
    expect(first).toContain(head.部店名)
    expect(first).toContain(head.扱者コード)
    expect(first).toContain(head.扱者名)
    expect(first).toContain(String(head.口座番号))
    expect(first).toContain(head.顧客名)
    expect(first).toContain(head.顧客名カナ)
  })

  it('[CLV-03] 列がモックの並びどおり 15 列で、操作列を持たない', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      '部店',
      '扱者',
      '口座番号',
      '顧客名',
      '年齢',
      '取引規制',
      '投資方針',
      'コンプラ',
      '口座区分',
      '個人／法人',
      '円貨預り金',
      'USD預り金',
      '成長投資枠',
      '米国株評価額',
      '評価損益',
    ])
  })

  it('[CLV-04] 米国株評価額と評価損益は値を持たず常に — を出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    for (const row of rows(wrapper)) {
      const cells = row.findAll('td')
      expect(cells[13].text()).toBe('—')
      expect(cells[14].text()).toBe('—')
    }
  })

  it('[CLV-05] 手動操作された行にだけ印が付く', async () => {
    const { wrapper } = await mountView()
    await settle()

    const marked = rows(wrapper).filter((row) => row.classes().includes('is-user-modified'))
    const expected = firstPage.filter((row) => row.ユーザー操作フラグ === 1)

    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(PAGE_SIZE)
    expect(marked).toHaveLength(expected.length)
    expect(marked.map((row) => row.findAll('td')[2].text())).toEqual(
      expected.map((row) => String(row.口座番号)),
    )
  })

  it('[CLV-06] 金額は桁区切りと単位を後置して出す', async () => {
    // 円貨・外貨・成長投資枠のすべてに値がある行を使う
    const target = firstPage.find(
      (row) => row.円貨預り金 > 0 && row.外貨預り金 > 0 && row.NISA買付可能額_当年 > 0,
    )
    expect(target).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    const cells = cellsFor(wrapper, target.口座番号)
    expect(cells[10].text()).toBe(jpyText(target.円貨預り金))
    expect(cells[11].text()).toBe(usdText(target.外貨預り金))
    expect(cells[12].text()).toBe(jpyText(target.NISA買付可能額_当年))
  })

  it('[CLV-07] 値が無い金額は — で、残高 0 は 0 円になる', async () => {
    const noUsd = firstPage.find((row) => row.外貨預り金 === null)
    const zeroJpy = firstPage.find((row) => row.円貨預り金 === 0)
    const noQuota = firstPage.find((row) => row.NISA買付可能額_当年 === null)
    // 0 と null の両方を持つフィクスチャでないと、このシナリオは意味を失う
    expect(noUsd).toBeTruthy()
    expect(zeroJpy).toBeTruthy()
    expect(noQuota).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    expect(cellsFor(wrapper, noUsd.口座番号)[11].text()).toBe('—')
    expect(cellsFor(wrapper, noQuota.口座番号)[12].text()).toBe('—')
    // 残高 0 は「値が無い」ではないので — にしない
    expect(cellsFor(wrapper, zeroJpy.口座番号)[10].text()).toBe('0 円')
  })

  it('[CLV-08] 年齢は 歳 を付け、年齢の無い法人は — を出す', async () => {
    const person = firstPage.find((row) => row.年齢)
    const corporate = firstPage.find((row) => !row.年齢)
    expect(person).toBeTruthy()
    expect(corporate).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    expect(cellsFor(wrapper, person.口座番号)[4].text()).toBe(`${person.年齢}歳`)
    expect(cellsFor(wrapper, corporate.口座番号)[4].text()).toBe('—')
  })

  it('[CLV-09] 取引停止の行だけ取引規制をバッジで出す', async () => {
    const suspended = firstPage.find((row) => row.取引停止区分_全取引 === 1)
    const normal = firstPage.find((row) => row.取引停止区分_全取引 === 0)
    expect(suspended).toBeTruthy()
    expect(normal).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    const suspendedCell = cellsFor(wrapper, suspended.口座番号)[5]
    expect(suspendedCell.find('.badge').exists()).toBe(true)
    expect(suspendedCell.find('.badge').attributes('data-variant')).toBe('warning')
    expect(suspendedCell.text()).toBe(suspended.取引停止区分_全取引名)

    const normalCell = cellsFor(wrapper, normal.口座番号)[5]
    expect(normalCell.find('.badge').exists()).toBe(false)
    expect(normalCell.text()).toBe(normal.取引停止区分_全取引名)
  })

  it('[CLV-10] 事故処理口座は口座区分にバッジを併記する', async () => {
    const accident = firstPage.find((row) => row.事故処理口座区分 === '1')
    const normal = firstPage.find((row) => row.事故処理口座区分 === '0')
    expect(accident).toBeTruthy()
    expect(normal).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    const accidentCell = cellsFor(wrapper, accident.口座番号)[8]
    // 区分名を置き換えるのではなく、横に足す
    expect(accidentCell.text()).toContain(accident.口座区分名)
    expect(accidentCell.find('.badge').text()).toBe('事故')

    const normalCell = cellsFor(wrapper, normal.口座番号)[8]
    expect(normalCell.text()).toBe(normal.口座区分名)
    expect(normalCell.find('.badge').exists()).toBe(false)
  })

  it('[CLV-11] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="customers-empty"]').text()).toBe(
      '該当する顧客はありません。',
    )
    expect(exists(wrapper, 'customers-table')).toBe(false)
  })

  it('[CLV-12] 取得に失敗したときは理由と再試行を出す', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="customers-error"]').text()).toContain(ERROR_MESSAGE)
    expect(exists(wrapper, 'customers-table')).toBe(false)
    expect(exists(wrapper, 'customers-empty')).toBe(false)
  })

  it('[CLV-13] 再試行で読み直すと表が出る', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await wrapper.find('[data-testid="customers-error"]').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'customers-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[CLV-14] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(router.currentRoute.value.query.offset).toBe(String(PAGE_SIZE))
    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(rows(wrapper)[0].findAll('td')[2].text()).toBe(String(secondPage[0].口座番号))
  })

  it('[CLV-15] 検索すると URL に条件が乗り絞り込まれる', async () => {
    const expected = sorted.filter(
      (row) => row.部店コード === BRANCH_CODE && row.顧客名.includes(CUSTOMER_NAME),
    )
    const { wrapper, router } = await mountView({ withCodes: true })
    await settle()

    await wrapper.find('[data-testid="customers-branch-code"]').setValue(BRANCH_CODE)
    await wrapper.find('[data-testid="customers-customer-name"]').setValue(CUSTOMER_NAME)
    await wrapper.find('[data-testid="customers-search"]').trigger('submit')
    await settle()

    // 条件を変えたら 1 ページ目に戻すので offset は付かない
    expect(router.currentRoute.value.query).toEqual({
      branch_code: BRANCH_CODE,
      customer_name: CUSTOMER_NAME,
    })
    expect(rows(wrapper)).toHaveLength(expected.length)
  })

  it('[CLV-16] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ query: { branch_code: BRANCH_CODE } })
    await settle()
    expect(rows(wrapper).length).toBeLessThan(PAGE_SIZE)

    await wrapper.find('[data-testid="customers-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CLV-17] URL クエリの条件が入力欄と一覧に反映される', async () => {
    const ACCOUNT_TYPE = '1'
    const expected = sorted.filter(
      (row) => row.部店コード === BRANCH_CODE && row.口座区分 === ACCOUNT_TYPE,
    )
    expect(expected.length).toBeGreaterThan(0)

    const { wrapper } = await mountView({
      query: { branch_code: BRANCH_CODE, account_type: ACCOUNT_TYPE },
      withCodes: true,
    })
    await settle()

    expect(wrapper.find('[data-testid="customers-branch-code"]').element.value).toBe(BRANCH_CODE)
    expect(wrapper.find('[data-testid="customers-account-type"]').element.value).toBe(ACCOUNT_TYPE)
    expect(countText(wrapper)).toContain(String(expected.length))
    expect(rows(wrapper)).toHaveLength(expected.length)
  })

  it('[CLV-18] プルダウンの選択肢はコードマスタから来る', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    const expectedFor = (name, placeholder) => [
      { value: '', label: placeholder },
      ...codeMasters[name].map(({ code, label }) => ({ value: code, label })),
    ]

    expect(optionsOf(wrapper, 'customers-branch-code')).toEqual(
      expectedFor('部店', '-- 全部店 --'),
    )
    expect(optionsOf(wrapper, 'customers-handler-code')).toEqual(
      expectedFor('扱者', '-- 全扱者 --'),
    )
    expect(optionsOf(wrapper, 'customers-restriction')).toEqual(
      expectedFor('取引停止区分_全取引', '-- すべて --'),
    )
    expect(optionsOf(wrapper, 'customers-account-type')).toEqual(
      expectedFor('口座区分', '-- 全区分 --'),
    )
    expect(optionsOf(wrapper, 'customers-corporate-type')).toEqual(
      expectedFor('法人区分', '-- すべて --'),
    )
  })

  it('[CLV-19] コードマスタが未取得でも検索カードは描ける', async () => {
    // この画面はコードマスタを読み込まない（main.js が起動時に 1 回だけ読む）
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'customers-search')).toBe(true)
    for (const testid of [
      'customers-branch-code',
      'customers-handler-code',
      'customers-restriction',
      'customers-account-type',
      'customers-corporate-type',
    ]) {
      // 既定の選択肢（placeholder）だけが並ぶ
      expect(optionsOf(wrapper, testid)).toHaveLength(1)
      expect(optionsOf(wrapper, testid)[0].value).toBe('')
    }
  })

  it('[CLV-20] 説明バナーと検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler()]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'customers-description')).toBe(true)
      expect(exists(wrapper, 'customers-search')).toBe(true)
    }
  })

  it('[CLV-21] 読むだけの画面なので追加・編集・削除の導線を持たない', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'customers-add')).toBe(false)
    // 行の中にボタンが無いこと（操作列そのものが無い）
    expect(rows(wrapper)[0].findAll('button')).toHaveLength(0)
  })

  it('[CLV-22] コードマスタの取得中は検索カードが回転マークを出して入力を受け付けない', async () => {
    const { wrapper } = await mountView({ pendingCodes: true })

    expect(exists(wrapper, 'customers-options-loading')).toBe(true)
    // 入力欄は fieldset ごと無効にする（select の disabled 属性は個々には付かない）
    expect(wrapper.find('[data-testid="customers-search"] fieldset').attributes('disabled')).toBe(
      '',
    )
    expect(wrapper.find('[data-testid="customers-search-submit"]').element.disabled).toBe(true)

    await settle()

    // 取得が終われば回転マークは消え、条件を入れられるようになる
    expect(exists(wrapper, 'customers-options-loading')).toBe(false)
    expect(
      wrapper.find('[data-testid="customers-search"] fieldset').attributes('disabled'),
    ).toBeUndefined()
    expect(wrapper.find('[data-testid="customers-search-submit"]').element.disabled).toBe(false)
  })
})

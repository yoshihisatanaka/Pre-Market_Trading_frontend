import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { codeEntries } from '@/mocks/fixtures/codes'
import { canceledCustomers, customers, reactivationWarning } from '@/mocks/fixtures/customers'
import { useCodesStore } from '@/stores/codes'
import { CUSTOMERS_PAGE_SIZE } from '@/stores/customers'
import { CUSTOMER_FIELDS, emptyCustomerForm } from '@/utils/customerFields'
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

/* ここから新規追加・編集モーダル用のヘルパ（入力欄の testid は customerFields.js の項目表から引く） */

const fieldOf = (key) => CUSTOMER_FIELDS.find((field) => field.key === key)
const addInput = (wrapper, key) =>
  wrapper.find(`[data-testid="customers-add-${fieldOf(key).testid}"]`)
const editInput = (wrapper, key) =>
  wrapper.find(`[data-testid="customers-edit-${fieldOf(key).testid}"]`)

const openAddModal = (wrapper) => wrapper.find('[data-testid="customers-add"]').trigger('click')
const openEditModal = (wrapper, id = String(head.ID)) =>
  wrapper.find(`[data-testid="customers-edit-${id}"]`).trigger('click')

/** 入力欄をまとめて埋める（キーは項目の key） */
async function fill(input, wrapper, values) {
  for (const [key, value] of Object.entries(values)) {
    await input(wrapper, key).setValue(value)
  }
}

async function submit(wrapper, action) {
  await wrapper.find(`[data-testid="customers-${action}-submit"]`).trigger('click')
  await settle()
}

const messagesOf = (wrapper, testid) =>
  wrapper.findAll(`[data-testid="${testid}"] li`).map((item) => item.text())

/** 入力欄の直下に出ている理由（FormField が aria-describedby で結び付けている） */
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

const requiredMessage = (field) =>
  field.control === 'select'
    ? `${field.label}を選択してください。`
    : `${field.label}を入力してください。`

/** 必須で初期値の無い項目（新規追加で利用者が埋めるもの） */
const MUST_FILL = CUSTOMER_FIELDS.filter((field) => field.required && field.initial === undefined)

// フィクスチャに無い口座番号（取消済みも含めた最大値 + 1）と、取消済みの口座番号
const NEW_ACCOUNT_NUMBER = String(
  Math.max(...[...customers, ...canceledCustomers].map((row) => row.口座番号)) + 1,
)
const CANCELED_NUMBER = String(canceledCustomers[0].口座番号)

/** 新規追加で埋める値。選択肢はコードマスタの先頭から取る */
const NEW_CUSTOMER = {
  accountNumber: NEW_ACCOUNT_NUMBER,
  branchCode: codeEntries('部店')[0].code,
  handlerCode: codeEntries('扱者')[0].code,
  customerName: 'テスト 花子',
  customerNameKana: 'ﾃｽﾄ ﾊﾅｺ',
  complianceRank: codeEntries('コンプラランク')[0].code,
  totalAssets: '0',
}

const NEW_NAME = '更新 太郎'

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

  it('[CLV-03] 列がモックの並びどおり 13 列で、右端に見出しの無い操作列が付く', async () => {
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
      // 操作列（編集）。見出しは空
      '',
    ])
  })

  it('[CLV-04] 米国株評価額と評価損益の列は無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 2026-09-28 に不要と決まり、列ごと削除した
    expect(headers(wrapper)).not.toContain('米国株評価額')
    expect(headers(wrapper)).not.toContain('評価損益')
    // 見出しだけ消えてセルが残る、といったずれが無い
    for (const row of rows(wrapper)) {
      expect(row.findAll('td')).toHaveLength(headers(wrapper).length)
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
      ...codeEntries(name).map(({ code, label }) => ({ value: code, label })),
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

  it('[CLV-21] ヘッダに新規追加があり、行の操作は編集だけで削除は無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'customers-add')).toBe(true)
    for (const [index, row] of rows(wrapper).entries()) {
      const buttons = row.findAll('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].attributes('data-testid')).toBe(`customers-edit-${firstPage[index].ID}`)
      expect(buttons[0].text()).toBe('編集')
    }
    // 削除は実装しない（2026-09-28 決定）
    expect(wrapper.findAll('[data-testid^="customers-delete"]')).toHaveLength(0)
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

  it('[CLV-23] 新規追加を押すと項目表どおりの空のフォームが開く', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    await openAddModal(wrapper)

    expect(exists(wrapper, 'customers-add-form')).toBe(true)
    const initial = emptyCustomerForm()
    for (const field of CUSTOMER_FIELDS) {
      const input = addInput(wrapper, field.key)
      expect(input.exists(), field.key).toBe(true)
      expect(input.element.value, field.key).toBe(initial[field.key])
    }
    // 新規では口座番号を入力させる（読み取り専用は編集だけ）
    expect(addInput(wrapper, 'accountNumber').attributes('readonly')).toBeUndefined()
  })

  it('[CLV-24] 必須が未入力なら項目の直下に理由を出し、API へ送らない', async () => {
    let calls = 0
    server.use(
      http.post('*/api/masters/customers/validate', () => {
        calls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.post('*/api/masters/customers', () => {
        calls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(true)
    expect(MUST_FILL.length).toBeGreaterThan(0)
    for (const field of MUST_FILL) {
      expect(fieldError(wrapper, addInput(wrapper, field.key)), field.key).toBe(
        requiredMessage(field),
      )
    }
    // 無駄な往復をしない（事前検証も登録も呼ばない）
    expect(calls).toBe(0)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CLV-25] 追加が成功するとモーダルが閉じ、成功通知と増えた件数が出る', async () => {
    // 埋める値が必須項目を覆っていないと、項目が増えたときに黙って別の理由で落ちる
    expect(MUST_FILL.map((field) => field.key).sort()).toEqual(Object.keys(NEW_CUSTOMER).sort())
    const { wrapper, router } = await mountView({ withCodes: true })
    await settle()
    await openAddModal(wrapper)

    await fill(addInput, wrapper, NEW_CUSTOMER)
    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(false)
    // 口座番号の昇順なので追加した行が 1 ページ目に出るとは限らない。通知で何が増えたかを見る
    const notice = wrapper.find('[data-testid="customers-notice"]').text()
    expect(notice).toContain(NEW_ACCOUNT_NUMBER)
    expect(notice).toContain(NEW_CUSTOMER.customerName)
    expect(countText(wrapper)).toContain(String(TOTAL + 1))
    // 一覧の単方向フローには触らない
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[CLV-26] 既にある口座番号は事前検証の理由をモーダル内に箇条書きで出す', async () => {
    const existing = String(head.口座番号)
    const { wrapper } = await mountView({ withCodes: true })
    await settle()
    await openAddModal(wrapper)

    await fill(addInput, wrapper, { ...NEW_CUSTOMER, accountNumber: existing })
    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(true)
    expect(messagesOf(wrapper, 'customers-add-validation-error')).toEqual([
      `口座番号 ${existing} は既に登録されています`,
    ])
    // 通信は成功しているので、サーバ障害の枠には出さない
    expect(exists(wrapper, 'customers-add-error')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CLV-27] 取消済みの口座番号は 1 回目に警告を出し、押し直すと登録する', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()
    await openAddModal(wrapper)
    await fill(addInput, wrapper, { ...NEW_CUSTOMER, accountNumber: CANCELED_NUMBER })

    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(true)
    expect(messagesOf(wrapper, 'customers-add-validation-warning')).toEqual([
      reactivationWarning(CANCELED_NUMBER),
    ])
    expect(exists(wrapper, 'customers-add-validation-error')).toBe(false)
    // 警告の段階ではまだ登録していない
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(exists(wrapper, 'customers-notice')).toBe(false)

    // 承知して押し直す
    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(false)
    expect(wrapper.find('[data-testid="customers-notice"]').text()).toContain(CANCELED_NUMBER)
    expect(countText(wrapper)).toContain(String(TOTAL + 1))
  })

  it('[CLV-28] 「編集」を押すと現在値が入り、口座番号は読み取り専用になる', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    await openEditModal(wrapper)

    expect(exists(wrapper, 'customers-edit-form')).toBe(true)
    expect(editInput(wrapper, 'accountNumber').element.value).toBe(String(head.口座番号))
    expect(editInput(wrapper, 'customerName').element.value).toBe(head.顧客名)
    expect(editInput(wrapper, 'customerNameKana').element.value).toBe(head.顧客名カナ)
    expect(editInput(wrapper, 'branchCode').element.value).toBe(head.部店コード)
    expect(editInput(wrapper, 'handlerCode').element.value).toBe(head.扱者コード)
    expect(editInput(wrapper, 'totalAssets').element.value).toBe(String(head.総預り資産))
    expect(editInput(wrapper, 'suspendAll').element.value).toBe(String(head.取引停止区分_全取引))
    // 業務キーは変更不可（CustomerUpdateRequest に無い）
    expect(editInput(wrapper, 'accountNumber').attributes('readonly')).toBeDefined()
    expect(editInput(wrapper, 'customerName').attributes('readonly')).toBeUndefined()
  })

  it('[CLV-29] 更新するとモーダルが閉じ、成功通知と一覧の該当行が新しい内容になる', async () => {
    const { wrapper } = await mountView({ withCodes: true })
    await settle()
    await openEditModal(wrapper)

    await fill(editInput, wrapper, { customerName: NEW_NAME })
    await submit(wrapper, 'edit')

    expect(exists(wrapper, 'customers-edit-form')).toBe(false)
    const notice = wrapper.find('[data-testid="customers-notice"]').text()
    expect(notice).toContain(String(head.口座番号))
    expect(notice).toContain(NEW_NAME)
    expect(rowFor(wrapper, head.口座番号).text()).toContain(NEW_NAME)
    // 更新は行を増やさない
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CLV-30] 競合(409)は通信・サーバ障害の枠に出し、事前検証の枠には出さない', async () => {
    const detail = '他のユーザーによって口座情報が更新されています。'
    server.use(
      http.put('*/api/masters/customers/:id', () => HttpResponse.json({ detail }, { status: 409 })),
    )
    const { wrapper } = await mountView({ withCodes: true })
    await settle()
    await openEditModal(wrapper)

    await fill(editInput, wrapper, { customerName: NEW_NAME })
    await submit(wrapper, 'edit')

    expect(exists(wrapper, 'customers-edit-form')).toBe(true)
    expect(wrapper.find('[data-testid="customers-edit-error"]').text()).toContain(detail)
    expect(exists(wrapper, 'customers-edit-validation-error')).toBe(false)
  })

  it('[CLV-31] 編集で必須を空にすると項目の直下に理由を出し、API へ送らない', async () => {
    let putCalls = 0
    server.use(
      http.put('*/api/masters/customers/:id', () => {
        putCalls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView({ withCodes: true })
    await settle()
    await openEditModal(wrapper)

    await fill(editInput, wrapper, { customerName: '' })
    await submit(wrapper, 'edit')

    expect(exists(wrapper, 'customers-edit-form')).toBe(true)
    expect(fieldError(wrapper, editInput(wrapper, 'customerName'))).toBe(
      requiredMessage(fieldOf('customerName')),
    )
    expect(putCalls).toBe(0)
    expect(exists(wrapper, 'customers-notice')).toBe(false)
  })

  it('[CLV-32] 警告のあとに入力を書き換えたら承知扱いにせず、事前検証からやり直す', async () => {
    const REWRITTEN_NAME = '書き換え 次郎'
    const { wrapper } = await mountView({ withCodes: true })
    await settle()
    await openAddModal(wrapper)
    await fill(addInput, wrapper, { ...NEW_CUSTOMER, accountNumber: CANCELED_NUMBER })
    await submit(wrapper, 'add')
    const warning = [reactivationWarning(CANCELED_NUMBER)]
    expect(messagesOf(wrapper, 'customers-add-validation-warning')).toEqual(warning)

    // 警告を見たあとで入力を変えて押す（警告の確認を経ずに別の内容を登録させない）
    await fill(addInput, wrapper, { customerName: REWRITTEN_NAME })
    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(true)
    expect(messagesOf(wrapper, 'customers-add-validation-warning')).toEqual(warning)
    expect(exists(wrapper, 'customers-notice')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))

    // 書き換えた入力のまま押し直せば、その内容を承知したものとして登録する
    await submit(wrapper, 'add')

    expect(exists(wrapper, 'customers-add-form')).toBe(false)
    expect(wrapper.find('[data-testid="customers-notice"]').text()).toContain(REWRITTEN_NAME)
    expect(countText(wrapper)).toContain(String(TOTAL + 1))
  })
})

import { expect, test } from '@playwright/test'
import { CUSTOMER_FIELDS } from '../src/utils/customerFields'
import {
  apiContext,
  cleanupMarked,
  fetchAll,
  listHelpers,
  logExchange,
  RESERVED_YEAR,
  skipUnlessRealApi,
} from './helpers/realApi.js'

/*
 * 顧客マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/customers-real-api.md（タイトル先頭の [CUR-xx] が対応 ID）
 *
 * customers.spec.js（CU）とは目的が違う。CU は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・口座番号・部店コードは実行時に画面か API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test customers.real-api
 *
 * CUR-02 以降は実 DB に登録・更新・論理削除を行う。ローカルの開発 DB 前提。
 * 試験用の行は口座番号の範囲（2035000〜2035999）と顧客名の接頭辞で見分け、
 * 開始時と終了時に有効なものを API で削除する（画面に削除の導線は無い）。
 */

const PATH = '/masters/customers'
// 実 API のパス（openapi.json）。編集・削除のパスキーは integer の account_id（行の ID）
const API_PATH = '/api/masters/customers'
// 一覧の応答の配列キー（openapi.json の CustomerListResponse.customers）
const LIST_KEY = 'customers'

// src/stores/customers.js の CUSTOMERS_PAGE_SIZE と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び（src/views/CustomerListView.vue の columns）。セルを列名で引く索引 */
const COLUMNS = [
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
  '',
]

/*
 * 試験用の口座番号の範囲。業務キーで削除は論理削除なので、一度使った値は再有効化の経路に入る。
 * CUR-02 は素の新規登録を見たいので、この範囲から「取消済みも含めて未使用」の値を選ぶ。
 * 実運用の口座番号（7 桁。画面の例は 1230001）と混ざらないよう、年を頭に付けた 7 桁に寄せる。
 */
const ACCOUNT_MIN = RESERVED_YEAR * 1000
const ACCOUNT_MAX = ACCOUNT_MIN + 999

/*
 * 登録は個人（法人区分の既定）で行う。業務規則は openapi.json の CustomerRequest / CustomerValidateRequest の
 * description と docs/api/requests.md #45 の回答（2026-10-06）:
 *   顧客名     … 個人は姓名の間を全角スペースで区切る
 *   顧客名カナ … 半角カナ・半角数字・ハイフン・半角スペースだけ。個人は姓名の間を半角スペースで区切る
 *   生年月日   … 個人は YYYYMMDD で必須（法人は '0' 固定。法人は NISA契約 '0'・特定口座区分 '3' も固定）
 *   コンプラランク … A〜J, X, Y, Z（A・B・Y・Z は発注制限の対象）。発注制限の無い C を選ぶ
 *   NISA契約 0 のとき NISA買付可能額は 0
 * 画面の入力検証はこの規則を持たない（サーバの事前検証に任せる）ので、spec の側で規則どおりの値を入れる。
 */
// 顧客名の目印。編集（CUR-10 / 11）でもこの接頭辞は保ち、姓名の間は全角スペース
const NAME_PREFIX = 'E2E実API確認'
// 全角スペース（U+3000）。直に書くと ESLint の no-irregular-whitespace に掛かるのでエスケープで書く
const FULL_WIDTH_SPACE = '　'
const TEST_NAME = `${NAME_PREFIX}${FULL_WIDTH_SPACE}顧客`
const EDITED_NAME = `${NAME_PREFIX}${FULL_WIDTH_SPACE}変更後`
const ALT_NAME = `${NAME_PREFIX}${FULL_WIDTH_SPACE}別経路`
const CONFLICT_NAME = `${NAME_PREFIX}${FULL_WIDTH_SPACE}画面`
// 顧客名カナ。半角カナで、姓名の間は半角スペース
const TEST_KANA = 'ﾃｽﾄ ｺｷｬｸ'
// 生年月日（個人は YYYYMMDD 必須。画面では任意項目なので REQUIRED_BLANK_FIELDS に入らない）
const TEST_BIRTH_DATE = '19800101'
// コンプラランク。発注制限の対象（A・B・Y・Z）を避ける。選択肢に無ければ空でない先頭を使う
const TEST_COMPLIANCE_RANK = 'C'
/*
 * 画面では任意の金額項目。未送信は事前検証では 0 扱いだが（#45 ①）、登録でも同じとは書かれていないので
 * 0 を明示する（NISA契約 0 のとき NISA買付可能額は 0、預り金の合計は総預り資産 0 以下）
 */
const ZERO_AMOUNT_KEYS = ['cashJpy', 'cashUsd', 'growthQuota', 'growthQuotaNext']

/** 新規追加で開いたとき値を持たない必須項目（src/utils/customerFields.js が正） */
const REQUIRED_BLANK_FIELDS = CUSTOMER_FIELDS.filter(
  (field) => field.required && field.initial === undefined,
)

const { settleList, openList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'customers',
})

/** beforeAll が選ぶ未使用の口座番号 */
let testAccount = 0
/** CUR-02 で登録した行の ID（実 API の採番）。CUR-08〜13 が使う */
let createdId = 0

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 2 段表示のセル（部店 / 扱者 / 顧客名）の上段。CustomerListView.vue の #cell-branch ほか */
async function primaryTextOf(cell) {
  return ((await cell.locator('span').first().textContent()) ?? '').trim()
}

/** 試験用の行（取消済みも含む）。顧客名の接頭辞で絞ってから口座番号の範囲で選ぶ */
async function fetchTestRows(api) {
  const rows = await fetchAll(api, API_PATH, LIST_KEY, {
    customer_name: NAME_PREFIX,
    include_deleted: true,
  })
  return rows.filter((row) => row.口座番号 >= ACCOUNT_MIN && row.口座番号 <= ACCOUNT_MAX)
}

/** 口座番号で行を引く（取消済みも含む）。顧客名に依らず引けるよう account_no で絞る */
async function fetchByAccount(api, accountNumber) {
  return fetchAll(api, API_PATH, LIST_KEY, { account_no: accountNumber, include_deleted: true })
}

/** ID から CustomerItem を引く（取消済みも含む）。無ければ null */
async function findCustomerById(api, id) {
  return (await fetchByAccount(api, testAccount)).find((row) => row.ID === id) ?? null
}

/*
 * 範囲の中で、取消済みも含めて一度も使われていない最小の口座番号を選ぶ。
 * 試験用の行の顧客名は編集で変わり得るので、顧客名ではなく口座番号で 1 件ずつ確かめる。
 */
async function pickUnusedAccount(api) {
  for (let candidate = ACCOUNT_MIN; candidate <= ACCOUNT_MAX; candidate += 1) {
    const res = await api.get(API_PATH, {
      params: { account_no: candidate, include_deleted: true, limit: 1, offset: 0 },
    })
    expect(res.ok(), `実 API から ${API_PATH} を取得できない: ${res.status()}`).toBe(true)
    if ((await res.json()).total === 0) return candidate
  }
  throw new Error(`${ACCOUNT_MIN}〜${ACCOUNT_MAX} に空きが無い。試験用の行を DB から整理すること`)
}

/**
 * 試験用の有効な行を消す。前回が途中で落ちた残骸もここで片付く。消した口座番号を返す（報告用）。
 * パスキーは openapi.json に従って ID。
 */
async function cleanupTestRows(api) {
  const removed = await cleanupMarked(api, {
    list: () => fetchTestRows(api),
    isMarked: (row) => row.取消区分 === 0,
    deletePathOf: (row) => `${API_PATH}/${row.ID}`,
  })
  return removed.map((row) => `${row.口座番号}(ID ${row.ID})`)
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: '顧客 新規追加' })
}

function editDialogOf(page) {
  return page.getByRole('dialog', { name: '顧客 編集' })
}

/**
 * 一覧の 1 行目の部店・扱者コード。実在する組み合わせでないと事前検証で弾かれるので、
 * 実データにある組をそのまま登録に使う。0 件なら空（選択肢の先頭を使う）。
 */
async function firstBranchAndHandler(page) {
  if ((await countOf(page)) === 0) return { branchCode: '', handlerCode: '' }
  const row = rowsOf(page).first()
  const branchCode = await primaryTextOf(cellOf(row, '部店'))
  const handlerCode = await primaryTextOf(cellOf(row, '扱者'))
  return {
    branchCode: branchCode === '—' ? '' : branchCode,
    handlerCode: handlerCode === '—' ? '' : handlerCode,
  }
}

/**
 * 新規追加のダイアログを開き、値を持たない必須項目をすべて埋めて送信する。
 * 項目は増える前提なので、項目の表から埋める（CU-16 の fillRequired と同じ考え方）。
 * 部店・扱者は渡された値、コンプラランクは TEST_COMPLIANCE_RANK、ほかのプルダウンは空でない最初の選択肢、
 * 数値は下限、文字は試験用の値。そのあと、画面では任意だが業務規則で要る項目（生年月日・金額の 0）を埋める。
 */
async function submitAdd(page, { branchCode, handlerCode }) {
  await page.getByTestId('customers-add').click()
  const dialog = addDialogOf(page)
  await expect(dialog).toBeVisible()

  const texts = {
    accountNumber: String(testAccount),
    customerName: TEST_NAME,
    customerNameKana: TEST_KANA,
  }
  const selects = { branchCode, handlerCode, complianceRank: TEST_COMPLIANCE_RANK }
  for (const field of REQUIRED_BLANK_FIELDS) {
    const input = dialog.getByTestId(`customers-add-${field.testid}`)
    if (field.control === 'select') {
      const preferred = selects[field.key]
      const available =
        preferred && (await input.locator(`option[value="${preferred}"]`).count()) > 0
      const value = available
        ? preferred
        : await input.locator('option:not([value=""])').first().getAttribute('value')
      await input.selectOption(value)
    } else if (field.key in texts) {
      await input.fill(texts[field.key])
    } else if (field.control === 'integer' || field.control === 'decimal') {
      await input.fill(String(field.min ?? 0))
    } else {
      await input.fill('ﾃｽﾄ')
    }
  }
  await dialog.getByTestId('customers-add-birth-date').fill(TEST_BIRTH_DATE)
  for (const key of ZERO_AMOUNT_KEYS) {
    const field = CUSTOMER_FIELDS.find((item) => item.key === key)
    await dialog.getByTestId(`customers-add-${field.testid}`).fill('0')
  }
  await dialog.getByTestId('customers-add-submit').click()
}

/**
 * 試験用の口座番号で検索して 1 件に絞る。一覧は口座番号の昇順なので、
 * 2035xxx の行が 1 ページ目に出るとは限らない。行を追いかけずに検索で引く。
 */
async function searchTestAccount(page) {
  await page.getByTestId('customers-account-number').fill(String(testAccount))
  await page.getByTestId('customers-search-submit').click()
  await expect(page).toHaveURL(new RegExp(`account_number=${testAccount}(&|$)`))
  await expect(page.getByTestId('customers-count')).toHaveText('1 件')
}

async function openTestAccount(page) {
  await openList(page)
  await searchTestAccount(page)
}

/** CUR-02 で登録した行（編集ボタンの testid が ID を持つので、それで絞る） */
function createdRowOf(page) {
  return rowsOf(page).filter({ has: page.getByTestId(`customers-edit-${createdId}`) })
}

async function openEdit(page) {
  await page.getByTestId(`customers-edit-${createdId}`).click()
  await expect(editDialogOf(page)).toBeVisible()
}

/** 一覧の取得リクエスト（クエリ名が実 API に届いているかを見る） */
function waitForListRequest(page, query, value) {
  return page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname === API_PATH && url.searchParams.get(query) === value
  })
}

/*
 * 画面から送られる PUT の応答を待つ。パスキーの部分は数字に限らず拾う
 * （ID が空なら '/api/masters/customers/' で終わる。それも捕まえて、原因の判る形で落とす）。
 */
function waitForPut(page) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' && /\/api\/masters\/customers\/[^/?]*$/.test(res.url()),
  )
}

/*
 * 画面から送られる POST（事前検証 /validate と登録）を標準出力に残す。
 * 登録は validate → POST の 2 本で、どちらで落ちたかは応答を見ないと判らない
 * （画面はどちらの障害も「内部サーバーエラー」の枠にまとめて出す）。
 */
function logPosts(page, label) {
  page.on('response', (res) => {
    if (res.request().method() !== 'POST') return
    if (!new URL(res.url()).pathname.startsWith(API_PATH)) return
    void logExchange(label, res)
  })
}

// 登録 → 重複 → 編集 → 競合 → 取消 → 再有効化 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('顧客マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const removed = await cleanupTestRows(api)
    if (removed.length > 0) console.log(`[beforeAll] 前回の残骸を削除した: ${removed.join(', ')}`)
    testAccount = await pickUnusedAccount(api)
    await api.dispose()
    console.log(`[beforeAll] 試験用の口座番号: ${testAccount}`)
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    const api = await apiContext(playwright)
    const removed = await cleanupTestRows(api)
    if (removed.length > 0) console.log(`[afterAll] 試験用の行を削除した: ${removed.join(', ')}`)
    await api.dispose()
  })

  test('[CUR-01] 実データで一覧が表示される', async ({ page }) => {
    await openList(page)
    await expectListConsistent(page, { pageSize: PAGE_SIZE })
  })

  test('[CUR-02] 新規追加が受理され、件数が 1 増える', async ({ page, playwright }) => {
    await openList(page)
    const before = await countOf(page)
    const pair = await firstBranchAndHandler(page)

    logPosts(page, 'CUR-02')
    await submitAdd(page, pair)

    await expect(addDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('customers-notice')
    await expect(notice).toContainText(`${testAccount} ${TEST_NAME}`)
    await expect(notice).toContainText('を追加しました。')
    await expect(page.getByTestId('customers-count')).toHaveText(`${before + 1} 件`)

    // 昇順のどこに入ったかは追わず、口座番号で検索して内容を見る
    await searchTestAccount(page)
    await expect(rowsOf(page).first()).toContainText(TEST_NAME)

    // API を直接引いても有効な行として存在する。以降のシナリオが使う ID をここで控える
    const api = await apiContext(playwright)
    const created = (await fetchByAccount(api, testAccount)).find((row) => row.取消区分 === 0)
    await api.dispose()
    expect(created, '登録した行が実 API の一覧に無い').toBeTruthy()
    expect(Number.isInteger(created.ID), '実 API の一覧が ID を返していない').toBe(true)
    createdId = created.ID
    await expect(createdRowOf(page)).toHaveCount(1)
  })

  test('[CUR-03] 口座番号で絞り込むと account_no が送られ、その口座だけが出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '顧客が 0 件なので絞り込みを確かめられない')

    const accountNumber = ((await columnOf(page, '口座番号').first().textContent()) ?? '').trim()
    test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

    // 画面の URL は account_number、実 API へは account_no（src/api/customers.js が変換する）
    const request = waitForListRequest(page, 'account_no', accountNumber)
    await page.getByTestId('customers-account-number').fill(accountNumber)
    await page.getByTestId('customers-search-submit').click()
    await request

    await expect(page).toHaveURL(new RegExp(`account_number=${accountNumber}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    // クエリ名が黙って無視されていれば他の口座が混ざる
    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '口座番号')).toHaveText(Array(shown).fill(accountNumber))
  })

  test('[CUR-04] 部店で絞り込むと、その部店の行だけが出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '顧客が 0 件なので絞り込みを確かめられない')

    const { branchCode } = await firstBranchAndHandler(page)
    test.skip(branchCode === '', '1 行目の部店コードが空')

    // 選択肢は実 API の /branches から来る。データにある部店が選択肢に無ければ噛み合っていない
    const select = page.getByTestId('customers-branch-code')
    await expect(
      select.locator(`option[value="${branchCode}"]`),
      `部店のプルダウンに ${branchCode} が無い（/branches と顧客データが食い違う）`,
    ).toHaveCount(1)

    const request = waitForListRequest(page, 'branch_code', branchCode)
    await select.selectOption(branchCode)
    await page.getByTestId('customers-search-submit').click()
    await request

    await expect(page).toHaveURL(new RegExp(`branch_code=${branchCode}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    for (let i = 0; i < shown; i += 1) {
      await expect(columnOf(page, '部店').nth(i)).toContainText(branchCode)
    }
  })

  test('[CUR-05] 顧客名で絞り込むと、その名前を含む行だけが出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '顧客が 0 件なので絞り込みを確かめられない')

    const name = await primaryTextOf(cellOf(rowsOf(page).first(), '顧客名'))
    test.skip(name === '' || name === '—', '1 行目の顧客名が空')

    const request = waitForListRequest(page, 'customer_name', name)
    await page.getByTestId('customers-customer-name').fill(name)
    await page.getByTestId('customers-search-submit').click()
    await request

    await expect(page).toHaveURL(/customer_name=/)
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    // 顧客名・カナのどちらに当たってもよい（セルは名前とカナの 2 段）
    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    for (let i = 0; i < shown; i += 1) {
      await expect(columnOf(page, '顧客名').nth(i)).toContainText(name)
    }
  })

  test('[CUR-06] 個人／法人で絞り込むと、表示名が揃う', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)

    // openapi.json の corporate_type（0: 個人, 1: 法人）
    const request = waitForListRequest(page, 'corporate_type', '1')
    await page.getByTestId('customers-corporate-type').selectOption('1')
    await page.getByTestId('customers-search-submit').click()
    await request

    await expect(page).toHaveURL(/corporate_type=1/)
    const filtered = await countOf(page)
    expect(filtered).toBeLessThanOrEqual(total)

    if (filtered === 0) {
      await expect(page.getByTestId('customers-empty')).toBeVisible()
      return
    }

    // 表示名はサーバが付けて返すので文言は固定せず、全行で揃っていることを見る
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))
    const labels = await columnOf(page, '個人／法人').allInnerTexts()
    expect(new Set(labels.map((text) => text.trim())).size).toBe(1)
  })

  test('[CUR-07] 「次のページ」で 2 ページ目が実データで出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total <= PAGE_SIZE, '1 ページに収まるのでページ送りを確かめられない')

    const pagination = page.getByTestId('customers-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await settleList(page)
    const last = Math.min(total, PAGE_SIZE * 2)
    await expect(rowsOf(page)).toHaveCount(last - PAGE_SIZE)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${total} 件中 ${PAGE_SIZE + 1}–${last} 件`,
    )
  })

  test('[CUR-08] 同じ口座番号をもう一度追加すると事前検証で弾かれる', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page, await firstBranchAndHandler(page))

    // 文言はサーバが決めるので固定しない。出し先が事前検証の枠であることだけを見る
    await expect(page.getByTestId('customers-add-validation-error')).toBeVisible()
    await expect(page.getByTestId('customers-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('customers-notice')).toHaveCount(0)
    await expect(page.getByTestId('customers-count')).toHaveText(`${before} 件`)
  })

  test('[CUR-09] 編集フォームの初期値が実 API の値と一致する', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const customer = await findCustomerById(api, createdId)
    await api.dispose()
    expect(customer, `CUR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    await openTestAccount(page)

    // 行の指定は ID。ここが 'customers-edit-'（id が空）なら実 API が ID を返していない
    const editButton = rowsOf(page).first().getByRole('button', { name: '編集' })
    await expect(editButton).toHaveAttribute('data-testid', `customers-edit-${createdId}`)
    await openEdit(page)

    const dialog = editDialogOf(page)
    const accountNumber = dialog.getByTestId('customers-edit-account-number')
    await expect(accountNumber).toHaveValue(String(customer.口座番号))
    await expect(dialog.getByTestId('customers-edit-customer-name')).toHaveValue(customer.顧客名 ?? '')
    await expect(dialog.getByTestId('customers-edit-customer-name-kana')).toHaveValue(
      customer.顧客名カナ ?? '',
    )
    await expect(dialog.getByTestId('customers-edit-branch-code')).toHaveValue(
      customer.部店コード ?? '',
    )
    await expect(dialog.getByTestId('customers-edit-handler-code')).toHaveValue(
      customer.扱者コード ?? '',
    )
    await expect(dialog.getByTestId('customers-edit-corporate-type')).toHaveValue(
      customer.法人区分 ?? '',
    )

    // 業務キーは編集で変えられない（CustomerUpdateRequest が 口座番号 を持たない）
    await expect(accountNumber).not.toBeEditable()
  })

  test('[CUR-10] 編集が受理され、再読み込みしても残る', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    let customer = await findCustomerById(api, createdId)
    expect(customer, `CUR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    /*
     * 合札（更新日時）が null だとフロントは送らず、照合の経路を通らない。
     * そのときは API で一度更新して更新日時を付けてから画面を開く（顧客名は同じ値で上書きする）。
     */
    if (!customer.更新日時) {
      const stamp = await api.put(`${API_PATH}/${createdId}`, { data: { 顧客名: customer.顧客名 } })
      expect(stamp.ok(), `下ごしらえの PUT が通らない: ${stamp.status()} ${await stamp.text()}`).toBe(
        true,
      )
      customer = await findCustomerById(api, createdId)
    }
    expect(customer.更新日時, '実 API が PUT のあとも 更新日時 を返さない').toBeTruthy()
    const heldUpdatedAt = customer.更新日時

    await openTestAccount(page)
    await openEdit(page)
    await editDialogOf(page).getByTestId('customers-edit-customer-name').fill(EDITED_NAME)

    const putResponse = waitForPut(page)
    await editDialogOf(page).getByTestId('customers-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('CUR-10', res)

    expect(
      new URL(res.url()).pathname,
      'パスキーが行の ID になっていない（実 API が ID を返していない徴候）',
    ).toBe(`${API_PATH}/${createdId}`)
    const sent = res.request().postDataJSON()
    // 業務キーは送らない（CustomerUpdateRequest に無い）
    expect(sent).not.toHaveProperty('口座番号')
    // 一覧で受け取った 更新日時 を、書式を変えずに合札として送っている
    expect(sent.更新日時).toBe(heldUpdatedAt)
    expect(res.status(), `実 API が編集を受理しない: ${body}`).toBe(200)

    await expect(editDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('customers-notice')
    await expect(notice).toContainText(`${testAccount} ${EDITED_NAME}`)
    await expect(notice).toContainText('を更新しました。')
    await expect(page.getByTestId('customers-count')).toHaveText('1 件')
    await expect(cellOf(createdRowOf(page), '顧客名')).toContainText(EDITED_NAME)

    // URL に検索条件が載っているので、再読み込みしても同じ 1 件に絞られる
    await page.reload()
    await settleList(page)
    await expect(cellOf(createdRowOf(page), '顧客名')).toContainText(EDITED_NAME)

    const after = await findCustomerById(api, createdId)
    await api.dispose()
    expect(after.顧客名).toBe(EDITED_NAME)
    expect(after.口座番号).toBe(testAccount)
  })

  test('[CUR-11] 別経路で先に更新された行は画面から更新できない', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const held = await findCustomerById(api, createdId)
    expect(held, `CUR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    // 画面を開いた時点の 更新日時 が、編集モーダルの握る合札になる
    await openTestAccount(page)
    await openEdit(page)

    /*
     * 別経路で同じ行を更新する（合札は送らない = 照合させない）。
     * 更新日時の粒度が秒だと、直前の更新と同じ秒に収まって値が変わらないことがあるので、
     * 変わるまで更新し直す。
     */
    await expect(async () => {
      const res = await api.put(`${API_PATH}/${createdId}`, { data: { 顧客名: ALT_NAME } })
      expect(res.ok(), `別経路の PUT が通らない: ${res.status()} ${await res.text()}`).toBe(true)
      const now = await findCustomerById(api, createdId)
      expect(now.更新日時).not.toBe(held.更新日時)
    }).toPass({ intervals: [500, 1000, 1000], timeout: 10_000 })

    await editDialogOf(page).getByTestId('customers-edit-customer-name').fill(CONFLICT_NAME)
    const putResponse = waitForPut(page)
    await editDialogOf(page).getByTestId('customers-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('CUR-11', res)

    expect(res.status(), `楽観ロックの衝突が拒否されていない: ${body}`).toBe(409)

    // 画面は 409 を特別扱いしない（通信・サーバ障害の枠に出す）
    await expect(page.getByTestId('customers-edit-error')).toBeVisible()
    await expect(page.getByTestId('customers-edit-validation-error')).toHaveCount(0)
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('customers-notice')).toHaveCount(0)

    // 画面からの上書きは入っていない
    const now = await findCustomerById(api, createdId)
    await api.dispose()
    expect(now.顧客名).toBe(ALT_NAME)
  })

  /*
   * 実 API の事前検証（POST /masters/customers/validate）は取消済みの口座番号でも警告を返さず、
   * 画面はそのまま登録へ進んで再有効化される（2026-10-07 実測。休場日・受注不可日は警告を返す）。
   * 警告を返すのが仕様かをバックエンドに確認する（docs/api/requests.md #50。経緯は docs/e2e/customers-real-api.md）。
   * 回答が来たら test.fixme を test に戻すか、期待値を回答に合わせる。CUR-13 も同じ前提なので一緒に止める
   */
  test.fixme('[CUR-12] 取消済みの口座番号を追加すると再有効化の警告が出る', async ({ page, playwright }) => {
    // 画面に削除の導線は無いので、取消済みの口座は API で作る
    const api = await apiContext(playwright)
    const res = await api.delete(`${API_PATH}/${createdId}`)
    expect(res.ok(), `下ごしらえの DELETE が通らない: ${res.status()} ${await res.text()}`).toBe(true)
    const deleted = await findCustomerById(api, createdId)
    await api.dispose()
    expect(deleted?.取消区分, '論理削除のはずが行が見つからないか取消済みになっていない').toBe(1)

    await openList(page)
    const before = await countOf(page)

    await submitAdd(page, await firstBranchAndHandler(page))

    const warning = page.getByTestId('customers-add-validation-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText(String(testAccount))
    // 警告は登録できない理由ではない
    await expect(page.getByTestId('customers-add-validation-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('customers-notice')).toHaveCount(0)
    await expect(page.getByTestId('customers-count')).toHaveText(`${before} 件`)
  })

  // CUR-12 と同じ理由で止めている（警告が出ないと前提が成り立たない）
  test.fixme('[CUR-13] 警告のあと押し直すと再有効化され、行は二重にならない', async ({
    page,
    playwright,
  }) => {
    await openList(page)
    const before = await countOf(page)

    await submitAdd(page, await firstBranchAndHandler(page))
    await expect(page.getByTestId('customers-add-validation-warning')).toBeVisible()

    // 入力を変えずに押し直すと、承知したものとして登録へ進む（CustomerListView.vue の warnedForm）
    await addDialogOf(page).getByTestId('customers-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('customers-notice')).toContainText('を追加しました。')
    await expect(page.getByTestId('customers-count')).toHaveText(`${before + 1} 件`)

    const api = await apiContext(playwright)
    const rows = await fetchByAccount(api, testAccount)
    await api.dispose()
    const active = rows.filter((row) => row.取消区分 === 0)
    // 同じ口座番号の有効な行は 1 件だけ（ID を引き継ぐかは期待値にしない）
    expect(active, `口座番号 ${testAccount} の有効な行が 1 件でない`).toHaveLength(1)
  })
})

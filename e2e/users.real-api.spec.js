import { expect, test } from '@playwright/test'
import {
  apiContext,
  fetchAll,
  listHelpers,
  logExchange,
  skipUnlessRealApi,
} from './helpers/realApi.js'

/*
 * ユーザ管理マスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/users-real-api.md（タイトル先頭の [UMR-xx] が対応 ID）
 *
 * users.spec.js（MSW 版）とは目的が違う。MSW 版はモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・社員コード・ロール・部店は実行時に画面か API の応答から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test users.real-api
 *
 * UMR-02 は実 DB に PUT を送る（ローカルの開発 DB 前提）。新規追加・削除が無く試験用の行を作れないので、
 * 値を変えない更新にする（ロール・状態をそのままで保存）。変わるのは 更新日時 / 更新者 だけ。
 * 開始前の値を控え、afterAll で食い違っていたら控えた値で PUT し直して戻す。
 */

const PATH = '/masters/users'
// 実 API のパス（openapi.json）。更新のパスキーは業務キーの操作者コード（行の ID ではない）
const API_PATH = '/api/masters/users'
// 一覧の応答の配列キー（openapi.json の OperatorListResponse.operators）
const LIST_KEY = 'operators'

// src/stores/users.js の USERS_PAGE_SIZE（= src/utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 列の並び（src/views/UserListView.vue の columns）。セルを列名で引く索引 */
const COLUMNS = ['社員コード', '氏名', '所属部店コード', '所属部店名', 'ロール', '状態', '操作']

/** UMR-02 が保存する更新の本文の項目（OperatorUpsertRequest）。比較と戻しに使う */
const UPSERT_KEYS = ['氏名', 'ロールコード', '部店コード', '受注者コード', '有効フラグ']

const { settleList, openList, countOf, rowsOf, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'users',
})

/** UMR-02 の対象の更新前の値（OperatorItem）。afterAll が戻すのに使う */
let snapshot = null

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

function editDialogOf(page) {
  return page.getByRole('dialog', { name: 'ユーザの権限設定' })
}

/** 一覧の取得（GET /api/masters/users）の応答を待つ。条件を足すときは match で絞る */
function waitForList(page, match = () => true) {
  return page.waitForResponse((res) => {
    if (res.request().method() !== 'GET') return false
    const url = new URL(res.url())
    return url.pathname === API_PATH && match(url.searchParams)
  })
}

/** 一覧を開き、そのとき画面が受け取った応答（URL と本文）を返す */
async function openListWithResponse(page, query = '') {
  const response = waitForList(page)
  await openList(page, query)
  const res = await response
  expect(res.status(), `${API_PATH} が 200 で返らない: ${await res.text()}`).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body[LIST_KEY]), `${API_PATH} の応答に配列 ${LIST_KEY} が無い`).toBe(true)
  return { params: new URL(res.url()).searchParams, body }
}

/** 検索の選択肢（部店・ロール）の読み込みが終わるのを待つ */
async function settleOptions(page) {
  await expect(page.getByTestId('users-options-loading')).toHaveCount(0)
}

/** 検索を押して、その取得の応答を返す */
async function submitSearch(page, match) {
  const response = waitForList(page, match)
  await page.getByTestId('users-search-submit').click()
  const res = await response
  expect(res.status(), `${API_PATH} が 200 で返らない: ${await res.text()}`).toBe(200)
  return res.json()
}

/** ID から OperatorItem を引く（無効も含む）。無ければ null */
async function findOperatorById(api, id) {
  const rows = await fetchAll(api, API_PATH, LIST_KEY, { include_inactive: true })
  return rows.find((row) => row.ID === id) ?? null
}

/** OperatorItem → 更新の本文（画面の updateUser と同じく、空は null） */
function upsertBodyOf(operator) {
  return {
    氏名: operator.氏名 || null,
    ロールコード: operator.ロールコード,
    部店コード: operator.部店コード || null,
    受注者コード: operator.受注者コード || null,
    有効フラグ: operator.有効フラグ,
  }
}

test.describe('ユーザ管理マスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.afterAll(async ({ playwright }) => {
    if (!snapshot) return

    // UMR-02 の対象が更新前の値のままかを確かめ、食い違っていたら戻す（null 上書きの事故を残さない）
    const api = await apiContext(playwright)
    const now = await findOperatorById(api, snapshot.ID)
    const expected = upsertBodyOf(snapshot)
    const changed = now && UPSERT_KEYS.some((key) => upsertBodyOf(now)[key] !== expected[key])
    if (changed) {
      const res = await api.put(`${API_PATH}/${encodeURIComponent(snapshot.操作者コード)}`, {
        data: expected,
      })
      await logExchange('afterAll 戻し', res)
      expect(res.ok(), `UMR-02 の対象を戻せない: ${snapshot.操作者コード}`).toBe(true)
    }
    await api.dispose()
  })

  test('[UMR-01] 実データで一覧が表示され、応答と件数・行数が噛み合う', async ({ page }) => {
    const { params, body } = await openListWithResponse(page)

    // 状態の既定は「すべて」なので無効も含めて取る
    expect(params.get('include_inactive')).toBe('true')

    const total = await expectListConsistent(page, { pageSize: PAGE_SIZE })
    expect(total, '件数表示が応答の total と違う').toBe(body.total)
    await expect(rowsOf(page)).toHaveCount(body[LIST_KEY].length)
  })

  test('[UMR-02] ロール・状態を変えずに保存すると、今の値のまま PUT が受理される', async ({
    page,
    playwright,
  }) => {
    const { body } = await openListWithResponse(page)
    const before = await countOf(page)
    await settleOptions(page)

    // ロールのプルダウン（権限マスタ）にあるロールの行を選ぶ。無いロールは PUT が 400 になる
    const roleCodes = await page
      .getByTestId('users-role')
      .locator('option:not([value=""])')
      .evaluateAll((options) => options.map((option) => option.value))
    const target = body[LIST_KEY].find((row) => roleCodes.includes(row.ロールコード))
    test.skip(!target, '1 ページ目に権限マスタのロールを持つ操作者がいない')

    snapshot = target
    const expected = upsertBodyOf(target)

    await page.getByTestId(`users-edit-${target.ID}`).click()
    const dialog = editDialogOf(page)
    await expect(dialog).toBeVisible()
    // 変えずに保存する（初期値が取得時の値であることもここで確かめる）
    await expect(dialog.getByTestId('users-edit-role')).toHaveValue(target.ロールコード)
    await expect(dialog.getByTestId('users-edit-active')).toHaveValue(
      String(target.有効フラグ === 1),
    )

    const putResponse = page.waitForResponse(
      (res) =>
        res.request().method() === 'PUT' &&
        new URL(res.url()).pathname.startsWith(`${API_PATH}/`),
    )
    await dialog.getByTestId('users-edit-submit').click()
    const res = await putResponse
    const resBody = await logExchange('UMR-02', res)

    expect(
      decodeURIComponent(new URL(res.url()).pathname),
      'パスキーが操作者コードになっていない',
    ).toBe(`${API_PATH}/${target.操作者コード}`)
    // 省くと null で上書きされる項目も、取得時の値のまま送っている
    const sent = res.request().postDataJSON()
    for (const key of UPSERT_KEYS) {
      expect(sent[key], `本文の ${key} が取得時の値と違う`).toBe(expected[key])
    }
    expect(res.status(), `実 API が保存を受理しない: ${resBody}`).toBe(200)

    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('users-notice')).toHaveText(
      `${target.氏名 || target.操作者コード}の権限設定を更新しました。`,
    )
    await expect(page.getByTestId('users-count')).toHaveText(`${before} 件`)

    // API を直接引いても値は変わっていない
    const api = await apiContext(playwright)
    const after = await findOperatorById(api, target.ID)
    await api.dispose()
    expect(after, `対象（ID ${target.ID}）が実 API の一覧に無い`).toBeTruthy()
    expect(upsertBodyOf(after)).toEqual(expected)
  })

  test('[UMR-03] 状態「有効」で絞ると include_inactive を送らず、有効な行だけが出る', async ({
    page,
  }) => {
    await openList(page)
    const total = await countOf(page)

    await page.getByTestId('users-status').selectOption('active')
    await submitSearch(page, (params) => !params.has('include_inactive'))

    await expect(page).toHaveURL(/status=active/)
    const filtered = await countOf(page)
    expect(filtered).toBeLessThanOrEqual(total)

    if (filtered === 0) {
      await expect(page.getByTestId('users-empty')).toBeVisible()
      return
    }
    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '状態')).toHaveText(Array(shown).fill('有効'))
  })

  test('[UMR-04] ロールで絞ると role が送られ、そのロールの行だけが返る', async ({ page }) => {
    const { body } = await openListWithResponse(page)
    const total = body.total
    test.skip(total === 0, '操作者が 0 件なので絞り込みを確かめられない')
    await settleOptions(page)

    const roleCode = body[LIST_KEY][0].ロールコード
    const select = page.getByTestId('users-role')
    await expect(
      select.locator(`option[value="${roleCode}"]`),
      `ロールのプルダウンに ${roleCode} が無い（権限マスタと操作者のロールが食い違う）`,
    ).toHaveCount(1)

    await select.selectOption(roleCode)
    const filteredBody = await submitSearch(page, (params) => params.get('role') === roleCode)

    await expect(page).toHaveURL(new RegExp(`role=${encodeURIComponent(roleCode)}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)
    expect(filteredBody.total).toBe(filtered)

    // クエリ名が黙って無視されていれば他のロールが混ざる
    const roles = filteredBody[LIST_KEY].map((row) => row.ロールコード)
    expect(new Set(roles)).toEqual(new Set([roleCode]))
    await expect(rowsOf(page)).toHaveCount(filteredBody[LIST_KEY].length)
  })

  test('[UMR-05] 所属部店で絞ると branch_code が送られ、その部店の行だけが出る', async ({
    page,
  }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '操作者が 0 件なので絞り込みを確かめられない')
    await settleOptions(page)

    const branchCode = ((await columnOf(page, '所属部店コード').first().textContent()) ?? '').trim()
    test.skip(branchCode === '' || branchCode === '—', '1 行目の所属部店コードが空')

    // 選択肢は実 API の /branches から来る。操作者の部店が選択肢に無ければ噛み合っていない
    const select = page.getByTestId('users-branch-code')
    await expect(
      select.locator(`option[value="${branchCode}"]`),
      `所属部店のプルダウンに ${branchCode} が無い（/branches と操作者の部店が食い違う）`,
    ).toHaveCount(1)

    await select.selectOption(branchCode)
    await submitSearch(page, (params) => params.get('branch_code') === branchCode)

    await expect(page).toHaveURL(new RegExp(`branch_code=${branchCode}(&|$)`))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThanOrEqual(total)

    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    await expect(columnOf(page, '所属部店コード')).toHaveText(Array(shown).fill(branchCode))
    // 部店名は /branches から引く。選択肢にある部店なので名前が引ける
    await expect(columnOf(page, '所属部店名').first()).not.toHaveText('—')
  })

  test('[UMR-06] 編集モーダルの初期値が応答の値と一致し、キャンセルで PUT を送らない', async ({
    page,
  }) => {
    const { body } = await openListWithResponse(page)
    test.skip(body.total === 0, '操作者が 0 件なので編集を確かめられない')
    await settleOptions(page)

    const first = body[LIST_KEY][0]
    // 行の指定は ID。ここが 'users-edit-0' なら実 API が ID を返していない
    const editButton = rowsOf(page).first().getByRole('button', { name: '編集' })
    await expect(editButton).toHaveAttribute('data-testid', `users-edit-${first.ID}`)

    let putSent = false
    page.on('request', (req) => {
      if (req.method() === 'PUT' && new URL(req.url()).pathname.startsWith(`${API_PATH}/`)) {
        putSent = true
      }
    })

    await editButton.click()
    const dialog = editDialogOf(page)
    await expect(dialog).toBeVisible()

    const code = dialog.getByTestId('users-edit-code')
    const name = dialog.getByTestId('users-edit-name')
    const branch = dialog.getByTestId('users-edit-branch')
    await expect(code).toHaveValue(first.操作者コード)
    await expect(name).toHaveValue(first.氏名 ?? '')
    if (first.部店コード) {
      await expect(branch).toHaveValue(new RegExp(`^${first.部店コード}( |$)`))
    } else {
      await expect(branch).toHaveValue('—')
    }
    // 社員コード・氏名・所属部店は読み取り専用（OperatorUpsertRequest に載るが画面では変えない）
    for (const input of [code, name, branch]) {
      await expect(input).not.toBeEditable()
    }

    await expect(dialog.getByTestId('users-edit-role')).toHaveValue(first.ロールコード)
    await expect(dialog.getByTestId('users-edit-active')).toHaveValue(
      String(first.有効フラグ === 1),
    )

    await dialog.getByTestId('users-edit-cancel').click()
    await expect(dialog).toBeHidden()
    expect(putSent, 'キャンセルなのに PUT が送られた').toBe(false)
  })

  test('[UMR-07] キーワードは keyword として送られ、エラーにならない', async ({ page }) => {
    await openList(page)

    // 実 API は keyword を無視する（docs/api/requests.md #67）。件数の増減は期待値にしない
    const keyword = 'E2E'
    await page.getByTestId('users-keyword').fill(keyword)
    await submitSearch(page, (params) => params.get('keyword') === keyword)

    await expect(page).toHaveURL(new RegExp(`keyword=${keyword}(&|$)`))
    await expectListConsistent(page, { pageSize: PAGE_SIZE })
  })

  test('[UMR-08] 「次のページ」で 2 ページ目が実データで出る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total <= PAGE_SIZE, '1 ページに収まるのでページ送りを確かめられない')

    const response = waitForList(page, (params) => params.get('offset') === String(PAGE_SIZE))
    await page
      .getByTestId('users-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await response

    await expect(page).toHaveURL(new RegExp(`offset=${PAGE_SIZE}`))
    await settleList(page)
    await expect(rowsOf(page)).toHaveCount(Math.min(total, PAGE_SIZE * 2) - PAGE_SIZE)
  })
})

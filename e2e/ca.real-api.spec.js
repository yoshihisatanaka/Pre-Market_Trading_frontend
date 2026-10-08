import { expect, test } from '@playwright/test'
import {
  apiContext,
  cleanupMarked,
  fetchAll,
  listHelpers,
  logExchange,
  marker,
  skipUnlessRealApi,
  toIsoDate,
} from './helpers/realApi.js'

/*
 * CAマスタを「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/ca-real-api.md（タイトル先頭の [CAR-xx] が対応 ID）
 *
 * ca.spec.js（CA）とは目的が違う。CA は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（件数・銘柄コードは実行時に画面か API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test ca.real-api
 *
 * CAR-02 以降は実 DB に登録・更新・削除を行う。ローカルの開発 DB 前提。
 * 試験用の行は備考の目印（NOTE_MARKER）で見分け、開始時と終了時に有効なものを削除する。
 */

const PATH = '/masters/ca'

// src/stores/ca.js の CA_PAGE_SIZE と同じ値。
// ストアは import.meta を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/*
 * 試験用の行の目印。CA には自然キーが無く POST は毎回 INSERT なので、後片付けは接頭辞で行を探す。
 * 編集（CAR-07 / CAR-08）でも接頭辞は保つこと（外すと後片付けから漏れる）。
 * TEST_NOTE は実行ごとに一意な備考で、CAR-02 で登録した行の ID をこれで特定する。
 */
const { prefix: NOTE_MARKER, value: TEST_NOTE } = marker()
const EDITED_NOTE = `${TEST_NOTE}（変更後）`
const ALT_NOTE = `${TEST_NOTE}（別経路）`
const CONFLICT_NOTE = `${TEST_NOTE}（画面）`

// 登録に使う値。日付は実運用のデータと混ざらないよう 2035 年に寄せる
const TEST_CA_TYPE = { value: '120', label: '株式分割' }
const TEST_DATES = {
  exRightsDate: '2035-06-08',
  effectiveDate: '2035-06-11',
  paymentDate: '2035-06-29',
}
const TEST_DENOMINATOR = '1'
const TEST_NUMERATOR = '2'

// 銘柄マスタに無いはずの銘柄コード（CARequest の 銘柄コード は最大 14 文字）
const UNKNOWN_STOCK_CODE = 'E2E-NOEXIST'

const { settleList, openList, countOf, rowsOf } = listHelpers({ path: PATH, testIdPrefix: 'ca' })

/** CAR-02 で借りる銘柄コード。beforeAll が既存の有効行から選ぶ */
let stockCode = ''
/** CAR-02 で登録した行の ID（実 API の採番）。CAR-06〜09 が使う */
let createdId = 0

/** 実 API の CA を全件集める（limit の上限を超える分はページを送って取る） */
function fetchAllCa(api, { includeDeleted = false } = {}) {
  return fetchAll(api, '/api/masters/ca', 'ca_list', { include_deleted: includeDeleted })
}

/** ID から CAItem を引く（取消済みも含む）。無ければ null */
async function findCaById(api, id) {
  const all = await fetchAllCa(api, { includeDeleted: true })
  return all.find((ca) => ca.ID === id) ?? null
}

/**
 * 目印の備考を持つ有効な行を消す。前回が途中で落ちた残骸もここで片付く。
 * 消した行の ID を返す（報告用）
 */
async function cleanupMarkedRows(api) {
  const removed = await cleanupMarked(api, {
    list: () => fetchAllCa(api, { includeDeleted: true }),
    isMarked: (ca) => ca.取消区分 === 0 && (ca.備考 ?? '').startsWith(NOTE_MARKER),
    deletePathOf: (ca) => `/api/masters/ca/${ca.ID}`,
  })
  return removed.map((ca) => ca.ID)
}

/** CAR-02 で登録した行（編集ボタンの testid が ID を持つので、それで絞る） */
function createdRowOf(page) {
  return rowsOf(page).filter({ has: page.getByTestId(`ca-edit-${createdId}`) })
}

function addDialogOf(page) {
  return page.getByRole('dialog', { name: 'CA 新規追加' })
}

function editDialogOf(page) {
  return page.getByRole('dialog', { name: 'CA 編集' })
}

/** 画面から送られる PUT /api/masters/ca/{id} の応答を待つ（事前検証の POST とは分ける） */
function waitForPut(page) {
  return page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/masters\/ca\/\d+$/.test(res.url()),
  )
}

// 登録 → 絞り込み → 検証 → 編集 → 競合 → 削除 は 1 本の流れなので順に実行する
test.describe.configure({ mode: 'serial' })

test.describe('CAマスタ（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright)
    const removed = await cleanupMarkedRows(api)
    if (removed.length > 0) console.log(`[beforeAll] 前回の残骸を削除した: ${removed.join(', ')}`)

    // 銘柄コードは実 API が銘柄マスタ実在を検証するので、既存の有効行から借りる
    const active = await fetchAllCa(api)
    stockCode = active.find((ca) => ca.銘柄コード)?.銘柄コード ?? ''
    await api.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    // 試験用の行を有効なまま残さない（論理削除なので行自体は DB に残る）
    const api = await apiContext(playwright)
    const removed = await cleanupMarkedRows(api)
    if (removed.length > 0) console.log(`[afterAll] 試験用の行を削除した: ${removed.join(', ')}`)
    await api.dispose()
  })

  test('[CAR-01] 実データで一覧が表示される', async ({ page }) => {
    await openList(page)

    const total = await countOf(page)
    // 件数表示と実際の行数が食い違わない（1 ページ目に出るのは表示件数まで）
    await expect(rowsOf(page)).toHaveCount(Math.min(total, PAGE_SIZE))

    // 4 状態のうち「データあり」に落ちている（0 件のときだけ空状態でよい）
    if (total > 0) {
      await expect(page.getByTestId('ca-table')).toBeVisible()
      await expect(page.getByTestId('ca-pagination')).toBeVisible()
      await expect(page.getByTestId('ca-empty')).toHaveCount(0)
    } else {
      await expect(page.getByTestId('ca-empty')).toBeVisible()
    }
    await expect(page.getByTestId('ca-loading')).toHaveCount(0)
    await expect(page.getByTestId('ca-error')).toHaveCount(0)
  })

  test('[CAR-02] 新規追加が受理され、件数が 1 増える', async ({ page, playwright }) => {
    expect(stockCode, '実 DB に銘柄コードを持つ CA が無く、借りる銘柄コードが無い').not.toBe('')

    await openList(page)
    const before = await countOf(page)

    await page.getByTestId('ca-add').click()
    await expect(addDialogOf(page)).toBeVisible()
    await page.getByTestId('ca-add-stock-code').fill(stockCode)
    await page.getByTestId('ca-add-type').selectOption(TEST_CA_TYPE.value)
    await page.getByTestId('ca-add-ex-rights-date').fill(TEST_DATES.exRightsDate)
    await page.getByTestId('ca-add-effective-date').fill(TEST_DATES.effectiveDate)
    await page.getByTestId('ca-add-payment-date').fill(TEST_DATES.paymentDate)
    await page.getByTestId('ca-add-denominator').fill(TEST_DENOMINATOR)
    await page.getByTestId('ca-add-numerator').fill(TEST_NUMERATOR)
    await page.getByTestId('ca-add-note').fill(TEST_NOTE)
    await page.getByTestId('ca-add-submit').click()

    await expect(addDialogOf(page)).toBeHidden()
    const notice = page.getByTestId('ca-notice')
    await expect(notice).toContainText(stockCode)
    await expect(notice).toContainText('を追加しました。')
    await expect(page.getByTestId('ca-count')).toHaveText(`${before + 1} 件`)
    // 一覧は効力発生日の降順なので、2035 年の行は 1 ページ目に出る
    await expect(rowsOf(page).filter({ hasText: TEST_NOTE })).toHaveCount(1)

    // API を直接引いても有効な行として存在する。以降のシナリオが使う ID をここで控える
    const api = await apiContext(playwright)
    const created = (await fetchAllCa(api)).find((ca) => ca.備考 === TEST_NOTE)
    await api.dispose()
    expect(created, '登録した行が実 API の一覧に無い').toBeTruthy()
    expect(created.取消区分).toBe(0)
    createdId = created.ID
    await expect(createdRowOf(page)).toHaveCount(1)
  })

  test('[CAR-03] 銘柄コードで絞り込むと、その銘柄の行だけが返る', async ({ page }) => {
    await openList(page)
    const total = await countOf(page)
    test.skip(total === 0, '実 DB に CA が 1 件も無いので絞り込みを確かめられない')

    // 期待値は書かず、1 行目に実際に出ている銘柄コードをそのまま条件にする。
    // 銘柄セルは「銘柄コード / Ticker」の 2 段なので 1 段目を採る
    const firstCell = await rowsOf(page).first().getByRole('cell').first().innerText()
    const code = firstCell.split('\n')[0].trim()
    test.skip(code === '' || code === '—', '1 行目に銘柄コードが無い')

    await page.getByTestId('ca-stock-code').fill(code)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(/stock_code=/)
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThanOrEqual(1)
    expect(filtered).toBeLessThanOrEqual(total)
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))

    // 表示されている行がすべて条件を含む（部分一致・大文字小文字は問わない）
    const cells = await rowsOf(page).locator('td:first-child').allInnerTexts()
    for (const text of cells) {
      expect(text.toUpperCase()).toContain(code.toUpperCase())
    }
  })

  test('[CAR-04] CA種別で絞り込むと、その種別の行だけが返る', async ({ page, playwright }) => {
    // 種別の表示名はサーバが返す CA種別名。CAR-02 の行から読む（無ければフロントの対応表と同じ名前）
    const api = await apiContext(playwright)
    const created = await findCaById(api, createdId)
    await api.dispose()
    const typeName = created?.CA種別名 || TEST_CA_TYPE.label

    await openList(page)
    const total = await countOf(page)

    await page.getByTestId('ca-type').selectOption(TEST_CA_TYPE.value)
    await page.getByTestId('ca-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`ca_type=${TEST_CA_TYPE.value}`))
    const filtered = await countOf(page)
    // CAR-02 で入れた行があるので 0 件にはならない
    expect(filtered).toBeGreaterThanOrEqual(1)
    expect(filtered).toBeLessThanOrEqual(total)
    await expect(rowsOf(page)).toHaveCount(Math.min(filtered, PAGE_SIZE))

    const typeCells = await rowsOf(page).locator('td:nth-child(2)').allInnerTexts()
    expect(new Set(typeCells.map((text) => text.trim()))).toEqual(new Set([typeName]))
  })

  test('[CAR-05] 銘柄マスタに無い銘柄コードは事前検証で弾かれる', async ({ page }) => {
    await openList(page)
    const before = await countOf(page)

    await page.getByTestId('ca-add').click()
    await expect(addDialogOf(page)).toBeVisible()
    await page.getByTestId('ca-add-stock-code').fill(UNKNOWN_STOCK_CODE)
    await page.getByTestId('ca-add-type').selectOption(TEST_CA_TYPE.value)
    await page.getByTestId('ca-add-note').fill(TEST_NOTE)
    await page.getByTestId('ca-add-submit').click()

    // 文言はサーバが決めるので固定しない。出し先が事前検証の枠であることだけを見る
    await expect(page.getByTestId('ca-add-validation-error')).toBeVisible()
    await expect(page.getByTestId('ca-add-error')).toHaveCount(0)

    await expect(addDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)
    await expect(page.getByTestId('ca-count')).toHaveText(`${before} 件`)
  })

  test('[CAR-06] 編集フォームの初期値が実 API の値と一致する', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const ca = await findCaById(api, createdId)
    await api.dispose()
    expect(ca, `CAR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    await openList(page)
    await page.getByTestId(`ca-edit-${createdId}`).click()
    await expect(editDialogOf(page)).toBeVisible()

    await expect(page.getByTestId('ca-edit-stock-code')).toHaveValue(ca.銘柄コード)
    // 銘柄コードは編集で変えられない（取り違えは削除して登録し直す運用）
    await expect(page.getByTestId('ca-edit-stock-code')).not.toBeEditable()
    await expect(page.getByTestId('ca-edit-type')).toHaveValue(ca.CA種別)
    await expect(page.getByTestId('ca-edit-ex-rights-date')).toHaveValue(toIsoDate(ca.権利付最終日))
    await expect(page.getByTestId('ca-edit-effective-date')).toHaveValue(toIsoDate(ca.効力発生日))
    await expect(page.getByTestId('ca-edit-payment-date')).toHaveValue(toIsoDate(ca.支払日))
    await expect(page.getByTestId('ca-edit-denominator')).toHaveValue(String(ca.分母 ?? ''))
    await expect(page.getByTestId('ca-edit-numerator')).toHaveValue(String(ca.分子 ?? ''))
    await expect(page.getByTestId('ca-edit-note')).toHaveValue(ca.備考 ?? '')
  })

  test('[CAR-07] 編集が受理され、再読み込みしても残る', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    let ca = await findCaById(api, createdId)
    expect(ca, `CAR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    /*
     * 合札（更新日時）が null だとフロントは送らず、照合の経路を通らない。
     * そのときは API で一度更新して更新日時を付けてから画面を開く（備考は同じ値で上書きする）。
     */
    if (!ca.更新日時) {
      const stamp = await api.put(`/api/masters/ca/${createdId}`, { data: { 備考: ca.備考 } })
      expect(stamp.ok(), `下ごしらえの PUT が通らない: ${stamp.status()} ${await stamp.text()}`).toBe(
        true,
      )
      ca = await findCaById(api, createdId)
    }
    await api.dispose()
    expect(ca.更新日時, '実 API が PUT のあとも 更新日時 を返さない').toBeTruthy()
    const heldUpdatedAt = ca.更新日時
    console.log(`[CAR-07] 一覧の 更新日時: ${heldUpdatedAt}`)

    await openList(page)
    const before = await countOf(page)
    await page.getByTestId(`ca-edit-${createdId}`).click()
    await expect(editDialogOf(page)).toBeVisible()
    await page.getByTestId('ca-edit-note').fill(EDITED_NOTE)

    const putResponse = waitForPut(page)
    await page.getByTestId('ca-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('CAR-07', res)

    // 一覧で受け取った ISO の 更新日時 を、書式を変えずに合札として送っている
    expect(res.request().postDataJSON().更新日時).toBe(heldUpdatedAt)
    expect(res.status(), `実 API が編集を受理しない: ${body}`).toBe(200)

    await expect(editDialogOf(page)).toBeHidden()
    await expect(page.getByTestId('ca-notice')).toContainText('を更新しました。')
    await expect(page.getByTestId('ca-count')).toHaveText(`${before} 件`)
    await expect(createdRowOf(page)).toContainText(EDITED_NOTE)

    await page.reload()
    await settleList(page)
    await expect(createdRowOf(page)).toContainText(EDITED_NOTE)
  })

  test('[CAR-08] 別経路で先に更新された行は画面から更新できない', async ({ page, playwright }) => {
    const api = await apiContext(playwright)
    const held = await findCaById(api, createdId)
    expect(held, `CAR-02 の行（ID ${createdId}）が実 API に無い`).toBeTruthy()

    // 画面を開いた時点の 更新日時 が、編集モーダルの握る合札になる
    await openList(page)
    await page.getByTestId(`ca-edit-${createdId}`).click()
    await expect(editDialogOf(page)).toBeVisible()

    /*
     * 別経路で同じ行を更新する（合札は送らない = 照合させない）。
     * 更新日時の粒度が秒だと、直前の更新と同じ秒に収まって値が変わらないことがあるので、
     * 変わるまで更新し直す。
     */
    await expect(async () => {
      const res = await api.put(`/api/masters/ca/${createdId}`, { data: { 備考: ALT_NOTE } })
      expect(res.ok(), `別経路の PUT が通らない: ${res.status()} ${await res.text()}`).toBe(true)
      const now = await findCaById(api, createdId)
      expect(now.更新日時).not.toBe(held.更新日時)
    }).toPass({ intervals: [500, 1000, 1000], timeout: 10_000 })
    const afterAlt = await findCaById(api, createdId)
    console.log(`[CAR-08] 画面が握る 更新日時: ${held.更新日時} / 別経路の更新後: ${afterAlt.更新日時}`)

    await page.getByTestId('ca-edit-note').fill(CONFLICT_NOTE)
    const putResponse = waitForPut(page)
    await page.getByTestId('ca-edit-submit').click()
    const res = await putResponse
    const body = await logExchange('CAR-08', res)

    expect(res.status(), `楽観ロックの衝突が拒否されていない: ${body}`).toBe(409)

    await expect(page.getByTestId('ca-edit-error')).toBeVisible()
    await expect(editDialogOf(page)).toBeVisible()
    await expect(page.getByTestId('ca-notice')).toHaveCount(0)

    // 画面からの上書きは入っていない
    const now = await findCaById(api, createdId)
    await api.dispose()
    expect(now.備考).toBe(ALT_NOTE)
  })

  test('[CAR-09] 削除は論理削除で、一覧から消えて取消区分=1 で残る', async ({ page, playwright }) => {
    await openList(page)
    const before = await countOf(page)

    await page.getByTestId(`ca-delete-${createdId}`).click()
    await expect(page.getByRole('dialog', { name: '削除確認' })).toBeVisible()
    await page.getByTestId('ca-delete-submit').click()

    await expect(page.getByRole('dialog', { name: '削除確認' })).toBeHidden()
    await expect(page.getByTestId('ca-notice')).toContainText('を削除しました。')
    await expect(page.getByTestId('ca-count')).toHaveText(`${before - 1} 件`)
    await expect(page.getByTestId(`ca-delete-${createdId}`)).toHaveCount(0)

    const api = await apiContext(playwright)
    const active = await fetchAllCa(api)
    const deleted = await findCaById(api, createdId)
    await api.dispose()

    // 既定の一覧からは消え、include_deleted=true では取消済みとして残る
    expect(active.some((ca) => ca.ID === createdId)).toBe(false)
    expect(deleted, 'include_deleted=true でも行が見つからない（物理削除されている）').toBeTruthy()
    expect(deleted.取消区分).toBe(1)
  })
})

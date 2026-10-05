import { expect, test } from '@playwright/test'
import { listHelpers, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * Dream登録状況を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/dream-status-real-api.md（タイトル先頭の [DSR-xx] が対応 ID）
 *
 * dream-status.spec.js（DS）とは目的が違う。DS は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせ（クエリ名の変換・状況コード一覧・
 * STS変更の導線がサーバの STS変更可 / 変更可能状況 に従うこと）だけを見るので、
 * 期待値に**データの中身を書かない**。絞り込みの値は、開いた時点（条件なし）に画面自身が受け取った
 * GET /orders/dream-status の応答から読む（テストから API を直接引くと X-User-Code が画面と違い、
 * 部店の限定で見える注文が変わるため）。0 件・値が空ならその行はスキップする。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test dream-status.real-api
 *
 * このファイルは実 DB に書き込まない（GET だけ）。STS変更（PUT）は元に戻せないので保留にしてあり
 * （DSR-02。理由はシナリオ文書）、DSR-03 は確認ダイアログをキャンセルで閉じて PUT が送られないことを確かめる。
 */

const PATH = '/orders/dream-status'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const API_PATH = '/api/orders/dream-status'
const STATUSES_API_PATH = '/api/orders/dream-status/statuses'

// src/stores/dreamStatus.js の DREAM_STATUS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

/** 絞り込みのクエリ名（実 API 側。src/api/dreamStatus.js の fetchDreamOrders） */
const FILTER_QUERIES = [
  'branch_code',
  'account_no',
  'symbol',
  'dream_status',
  'start_date',
  'end_date',
  'receipt_number',
]

/** 擬似コード。登録失敗・取消失敗の両方に当たる（openapi.json の /orders/dream-status/statuses） */
const ERROR_STATUS = 'ERROR'

/** エラー内容のポップアップの見出し（src/views/DreamStatusListView.vue の ERROR_TITLES） */
const ERROR_TITLES = { 9: 'Dream登録エラー詳細', C9: 'Dream取消エラー詳細' }

/** 列の並び（src/views/DreamStatusListView.vue の columns）。セルを列名で引く索引 */
const COLUMNS = [
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
]

// 値が無いときの表示
const EMPTY_CELL = '—'

const { openList, countOf, rowsOf, settleList, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'dream-status',
})

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${COLUMNS.indexOf(column) + 1})`)
}

/** 行の中の 1 セル。列名から位置を引く */
function cellOf(row, column) {
  return row.locator('td').nth(COLUMNS.indexOf(column))
}

/** 注文 ID で行を引く。注文ID 列の「#56」で一意に決まる */
function rowOf(page, id) {
  return rowsOf(page).filter({
    has: page.locator(`td:nth-child(${COLUMNS.indexOf('注文ID') + 1})`, {
      hasText: new RegExp(`^#${id}$`),
    }),
  })
}

/** 画面が出す状況の文言（DreamStatusListView.vue の statusLabel） */
function statusLabelOf(order) {
  return order.Dream状況名 || order.Dream状況 || EMPTY_CELL
}

/** 絞り込みのクエリが 1 つも載っていないか */
function isUnfiltered(url) {
  return FILTER_QUERIES.every((query) => !url.searchParams.has(query))
}

/** 実 API の GET のうち、パスが合い、条件（URL を受ける関数）を満たすものの応答を待つ */
function waitForApi(page, pathname, matches = () => true) {
  return page.waitForResponse((res) => {
    const url = new URL(res.url())
    return url.pathname === pathname && matches(url)
  })
}

/** クエリの値が合う GET /orders/dream-status の応答を待つ */
function waitForList(page, query, value) {
  return waitForApi(page, API_PATH, (url) => url.searchParams.get(query) === value)
}

/**
 * 一覧を開き、画面が受け取った条件なしの GET /orders/dream-status の応答を返す。
 * 絞り込みの値はここから読む（テストから API を直接引かない理由はファイル冒頭）
 */
async function openAndCapture(page) {
  const response = waitForApi(page, API_PATH, isUnfiltered)
  await openList(page)
  const res = await response
  expect(res.ok(), `${API_PATH} が ${res.status()} を返した`).toBe(true)
  const body = await res.json()
  return { body, total: await countOf(page), first: body.orders?.[0] ?? null }
}

/** 開いて、0 件ならスキップする */
async function openOrSkip(page) {
  const opened = await openAndCapture(page)
  test.skip(opened.total === 0 || !opened.first, '注文が 0 件なので絞り込みを確かめられない')
  return opened
}

/** 「検索」を押して、条件に合う応答と描画を待つ。応答の本文を返す */
async function submit(page, response) {
  await page.getByTestId('dream-status-search-submit').click()
  const res = await response
  expect(res.ok(), `${API_PATH} が ${res.status()} を返した`).toBe(true)
  await settleList(page)
  return res.json()
}

/** 絞り込んだあとの共通の期待値。件数が 1 以上かつ全件以下で、表示行と合う */
async function expectNarrowed(page, total) {
  const filtered = await countOf(page)
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThanOrEqual(total)
  await expect(page.getByTestId('dream-status-error')).toHaveCount(0)

  const shown = Math.min(filtered, PAGE_SIZE)
  await expect(rowsOf(page)).toHaveCount(shown)
  return { filtered, shown }
}

/** URL（画面）のクエリの値 */
function urlQuery(page, name) {
  return new URL(page.url()).searchParams.get(name)
}

/** Dream登録状況 のプルダウンの選択肢（value と表示名） */
function statusOptionsOf(page) {
  return page
    .getByTestId('dream-status-status')
    .locator('option')
    .evaluateAll((els) => els.map((el) => ({ value: el.value, label: el.textContent.trim() })))
}

/** 先頭の注文の Dream状況 で絞り込む（DSR-07 / DSR-13 が共用）。選択肢に無ければスキップ */
async function filterByFirstStatus(page, first) {
  const code = String(first.Dream状況 ?? '')
  const options = (await statusOptionsOf(page)).map((option) => option.value)
  test.skip(code === '' || !options.includes(code), `Dream登録状況のプルダウンに ${code} が無い`)

  await page.getByTestId('dream-status-status').selectOption(code)
  await submit(page, waitForList(page, 'dream_status', code))
  return code
}

function changeDialogOf(page) {
  return page.getByRole('dialog', { name: 'Dream状況を変更しますか？' })
}

test.describe('Dream登録状況（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[DSR-01] 開くと条件なしで GET /orders/dream-status が送られ、件数と一覧が食い違わない', async ({
    page,
  }) => {
    const { body } = await openAndCapture(page)

    const total = await expectListConsistent(page, { pageSize: PAGE_SIZE })
    // 件数表示は応答の total から出る
    expect(body.total).toBe(total)
    await expect(page.getByTestId('dream-status-description')).toBeVisible()
    await expect(page.getByTestId('dream-status-search')).toBeVisible()
  })

  // [DSR-02] STS変更の送信は保留（元に戻せない。理由は docs/e2e/dream-status-real-api.md）

  test('[DSR-03] STS変更の導線がサーバの STS変更可 / 変更可能状況 に従い、キャンセルなら PUT を送らない', async ({
    page,
  }) => {
    const { body, total } = await openOrSkip(page)

    const shownOrders = body.orders.slice(0, PAGE_SIZE)
    const changeable = shownOrders.filter((order) => order.STS変更可 === true)
    expect(shownOrders).toHaveLength(Math.min(total, PAGE_SIZE))

    const table = page.getByTestId('dream-status-table')
    await expect(table.getByTestId('dream-status-change')).toHaveCount(changeable.length)
    await expect(table.getByTestId('dream-status-locked')).toHaveCount(
      shownOrders.length - changeable.length,
    )
    if (changeable.length === 0) return

    const [order] = changeable
    const transitions = order.変更可能状況 ?? []
    expect(
      transitions.length,
      `注文ID ${order.ID} は STS変更可 なのに 変更可能状況 が空`,
    ).toBeGreaterThan(0)

    const row = rowOf(page, order.ID)
    await expect(row).toHaveCount(1)
    const select = row.getByTestId('dream-status-change')
    // 先頭はいまの状況（空値）、続けて遷移先
    await expect(select.locator('option')).toHaveText([
      statusLabelOf(order),
      ...transitions.map((transition) => transition.名称),
    ])
    await expect(select).toHaveValue('')

    // ここから先に PUT が飛んだら、キャンセルのつもりで実 DB を書き換えたことになる
    const puts = []
    page.on('request', (req) => {
      if (req.method() === 'PUT') puts.push(req.url())
    })

    const [target] = transitions
    await select.selectOption(target.コード)
    const dialog = changeDialogOf(page)
    await expect(dialog).toBeVisible()
    const summary = dialog.getByTestId('dream-status-change-summary')
    await expect(summary).toContainText(`#${order.ID}`)
    await expect(summary).toContainText(statusLabelOf(order))
    await expect(summary).toContainText(target.名称)

    await page.getByTestId('dream-status-change-cancel').click()

    await expect(dialog).toBeHidden()
    await expect(select).toHaveValue('')
    await expect(cellOf(row, 'Dream登録状況')).toHaveText(statusLabelOf(order))
    expect(puts, 'キャンセルしたのに PUT が送られた').toEqual([])
  })

  test('[DSR-04] Dream登録状況のプルダウンが GET /orders/dream-status/statuses の応答で組まれる', async ({
    page,
  }) => {
    // 選択肢は画面を開いたときにストアが引く。goto の前から待ち受ける
    const response = waitForApi(page, STATUSES_API_PATH)
    await openList(page)
    const res = await response
    expect(res.ok(), `${STATUSES_API_PATH} が ${res.status()} を返した`).toBe(true)
    const statuses = (await res.json()).statuses ?? []
    expect(statuses.length, '状況コード一覧が空').toBeGreaterThan(0)
    expect(statuses.map((status) => status.コード)).toContain(ERROR_STATUS)

    const expected = statuses.map((status) => ({ value: status.コード, label: status.名称 }))
    await expect
      .poll(async () => (await statusOptionsOf(page)).filter((option) => option.value !== ''))
      .toEqual(expected)
    expect((await statusOptionsOf(page))[0].value, '先頭が「全て」でない').toBe('')
    await expect(page.getByTestId('dream-status-status-field')).not.toContainText(
      '取得できませんでした',
    )
  })

  test('[DSR-05] 1 行目の口座番号で絞り込むと、実 API へ account_no が送られ、その口座だけが出る', async ({
    page,
  }) => {
    const { total } = await openOrSkip(page)

    const accountNumber = ((await columnOf(page, '口座番号').first().textContent()) ?? '').trim()
    test.skip(!/^\d+$/.test(accountNumber), `1 行目の口座番号が数字でない（${accountNumber}）`)

    // 画面の URL は account_number、実 API へは account_no（src/api/dreamStatus.js が変換する）
    await page.getByTestId('dream-status-account-number').fill(accountNumber)
    await submit(page, waitForList(page, 'account_no', accountNumber))

    expect(urlQuery(page, 'account_number')).toBe(accountNumber)
    const { shown } = await expectNarrowed(page, total)
    // クエリ名が黙って無視されていれば他の口座が混ざる
    await expect(columnOf(page, '口座番号')).toHaveText(Array(shown).fill(accountNumber))
  })

  test('[DSR-06] 1 行目の銘柄で絞り込むと、その銘柄の注文だけが出る', async ({ page }) => {
    const { total } = await openOrSkip(page)

    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('dream-status-symbol').fill(symbol)
    await submit(page, waitForList(page, 'symbol', symbol))

    expect(urlQuery(page, 'symbol')).toBe(symbol)
    const { shown } = await expectNarrowed(page, total)
    // 銘柄の列は Ticker（無ければ銘柄コード）。symbol は銘柄コードか Ticker の一致
    await expect(columnOf(page, '銘柄')).toHaveText(Array(shown).fill(symbol))
  })

  test('[DSR-07] 先頭の注文の Dream状況 で絞り込むと、その状況の注文だけが出る', async ({ page }) => {
    const { total, first } = await openOrSkip(page)

    const code = await filterByFirstStatus(page, first)

    expect(urlQuery(page, 'dream_status')).toBe(code)
    const { shown } = await expectNarrowed(page, total)
    // 状況の名前はサーバが行ごとに付ける。同じコードなら同じ名前になるはず
    await expect(columnOf(page, 'Dream登録状況')).toHaveText(Array(shown).fill(statusLabelOf(first)))
  })

  test('[DSR-08] 擬似コード ERROR で絞ると、出る行はすべて STS変更可 でエラー詳細が出る', async ({
    page,
  }) => {
    const { total } = await openAndCapture(page)

    const options = (await statusOptionsOf(page)).map((option) => option.value)
    test.skip(!options.includes(ERROR_STATUS), `Dream登録状況のプルダウンに ${ERROR_STATUS} が無い`)

    await page.getByTestId('dream-status-status').selectOption(ERROR_STATUS)
    const body = await submit(page, waitForList(page, 'dream_status', ERROR_STATUS))

    expect(urlQuery(page, 'dream_status')).toBe(ERROR_STATUS)
    const filtered = await countOf(page)
    expect(filtered).toBeLessThanOrEqual(total)
    await expect(page.getByTestId('dream-status-error')).toHaveCount(0)

    if (filtered === 0) {
      await expect(page.getByTestId('dream-status-empty')).toBeVisible()
      return
    }

    const shown = Math.min(filtered, PAGE_SIZE)
    await expect(rowsOf(page)).toHaveCount(shown)
    const table = page.getByTestId('dream-status-table')
    // ERROR は登録失敗・取消失敗だけに当たり、その 2 つだけが STS変更可
    await expect(table.getByTestId('dream-status-change')).toHaveCount(shown)
    await expect(table.getByTestId('dream-status-locked')).toHaveCount(0)

    const first = body.orders?.[0]
    expect(first, '件数が 1 以上なのに応答の orders が空').toBeTruthy()
    const title = ERROR_TITLES[first.Dream状況]
    expect(title, `ERROR で絞ったのに先頭の Dream状況 が ${first.Dream状況}`).toBeTruthy()

    await rowsOf(page).first().getByTestId('dream-status-error-trigger').hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(title)
    if (first.Dreamエラー内容) await expect(tooltip).toContainText(first.Dreamエラー内容)
  })

  test('[DSR-09] 先頭の注文の作成日で期間を絞ると、実 API へ start_date / end_date が送られる', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    // 検索の登録日は注文の作成日（列の「登録日時」= Dream完了日時 ではない）
    const date = /^\d{4}-\d{2}-\d{2}/.exec(String(first.作成日時 ?? ''))?.[0]
    test.skip(!date, `先頭の注文の作成日時が YYYY-MM-DD で始まらない（${first.作成日時}）`)

    await page.getByTestId('dream-status-date-from').fill(date)
    await page.getByTestId('dream-status-date-to').fill(date)
    await submit(
      page,
      waitForApi(
        page,
        API_PATH,
        (url) => url.searchParams.get('start_date') === date && url.searchParams.get('end_date') === date,
      ),
    )

    // 画面の URL は registered_from / registered_to
    expect(urlQuery(page, 'registered_from')).toBe(date)
    expect(urlQuery(page, 'registered_to')).toBe(date)
    await expectNarrowed(page, total)
  })

  test('[DSR-10] 先頭の注文の部店で絞り込むと、その部店の注文だけが出る', async ({ page }) => {
    const { total, first } = await openOrSkip(page)

    const branchCode = String(first.部店 ?? '')
    test.skip(branchCode === '', '先頭の注文の部店が空')

    await page.getByTestId('dream-status-branch-code').fill(branchCode)
    await submit(page, waitForList(page, 'branch_code', branchCode))

    expect(urlQuery(page, 'branch_code')).toBe(branchCode)
    const { shown } = await expectNarrowed(page, total)
    await expect(columnOf(page, '部店')).toHaveText(Array(shown).fill(branchCode))
  })

  test('[DSR-11] 受付番号のある注文の受注番号で絞り込むと、実 API へ receipt_number が送られる', async ({
    page,
  }) => {
    const { body, total } = await openOrSkip(page)

    const withReceipt = (body.orders ?? []).find((order) => order.受注番号)
    test.skip(!withReceipt, '1 ページ目に受注番号のある注文が無い')
    const receiptNumber = withReceipt.受注番号

    await page.getByTestId('dream-status-receipt-number').fill(receiptNumber)
    await submit(page, waitForList(page, 'receipt_number', receiptNumber))

    // 画面の URL は dream_ref
    expect(urlQuery(page, 'dream_ref')).toBe(receiptNumber)
    const { shown } = await expectNarrowed(page, total)
    await expect(columnOf(page, 'Dream受付番号')).toHaveText(Array(shown).fill(receiptNumber))
  })

  test('[DSR-12] 51 件以上あるとき「次のページ」で 2 ページ目が実 API から読まれる', async ({
    page,
  }) => {
    const { total } = await openAndCapture(page)
    test.skip(total <= PAGE_SIZE, `注文が ${total} 件で 2 ページ目が無い`)

    const response = waitForList(page, 'offset', String(PAGE_SIZE))
    const pagination = page.getByTestId('dream-status-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    expect(urlQuery(page, 'offset')).toBe(String(PAGE_SIZE))
    await expect(page.getByTestId('dream-status-count')).toHaveText(`${total} 件`)
    const last = Math.min(total, PAGE_SIZE * 2)
    await expect(rowsOf(page)).toHaveCount(last - PAGE_SIZE)
    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      `${total} 件中 ${PAGE_SIZE + 1}–${last} 件`,
    )
  })

  test('[DSR-13] 絞り込んだあと「クリア」で条件なしの一覧に戻る', async ({ page }) => {
    const { total, first } = await openOrSkip(page)

    await filterByFirstStatus(page, first)

    const response = waitForApi(page, API_PATH, isUnfiltered)
    await page.getByTestId('dream-status-search-clear').click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('dream-status-count')).toHaveText(`${total} 件`)
    await expect(page.getByTestId('dream-status-status')).toHaveValue('')
  })
})

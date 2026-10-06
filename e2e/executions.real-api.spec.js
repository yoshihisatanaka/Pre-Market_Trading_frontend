import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { listHelpers, skipUnlessRealApi } from './helpers/realApi.js'

/*
 * 約定照会を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/executions-real-api.md（タイトル先頭の [EXR-xx] が対応 ID）
 *
 * executions.spec.js（EX）とは目的が違う。EX は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせ（クエリ名と値の変換・summary・CSV 出力）
 * だけを見るので、期待値に**データの中身を書かない**。絞り込みの値は、開いた時点（条件なし）に
 * 画面自身が受け取った GET /executions の応答から読む（テストから API を直接引くと X-User-Code が
 * 画面と違い、部店の限定で見える約定が変わるため）。0 件・値が空ならその行はスキップする。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test executions.real-api
 *
 * 約定照会は読むだけの画面なので、このファイルは実 DB に書き込まない（GET だけ）。
 */

const PATH = '/executions'
// 実 API のパス（openapi.json）。dev サーバの /api プロキシ越しに届く
const API_PATH = '/api/executions'
const CSV_API_PATH = '/api/executions/export-csv'
const AUTH_ME_PATH = '/api/auth/me'

// src/stores/executions.js の EXECUTIONS_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

// openapi.json の /executions/export-csv の説明「上限10,000件」
const CSV_LIMIT = 10000

/** 絞り込みのクエリ名（実 API 側。src/api/executions.js の toSearchParams） */
const FILTER_QUERIES = [
  'branch_code',
  'symbol',
  'side',
  'status',
  'start_date',
  'end_date',
  'route',
]

/** 売買区分。画面の値（URL）・実 API のコード（openapi.json の side: 1:売 / 3:買）・表示 */
const SIDES = {
  sell: { code: '1', option: '売り', cell: '売', card: 'executions-summary-sell', label: '売り約定' },
  buy: { code: '3', option: '買い', cell: '買', card: 'executions-summary-buy', label: '買い約定' },
}

/** 列の並び（src/views/ExecutionListView.vue の BASE_COLUMNS と、見られるロールだけの「預託先」） */
const BASE_COLUMNS = [
  '約定ID',
  '注文ID',
  '口座番号',
  '顧客名',
  '銘柄',
  '売買',
  '元注文数量',
  '約定数量',
  '約定単価(USD)',
  '約定代金(USD)',
  '約定日時',
  '出来状況',
]
const ROUTE_COLUMN = '預託先'

// 預託先を見られるロール（ExecutionListView.vue の ROUTE_VIEWER_ROLES）
const ROUTE_VIEWER_ROLES = ['manager', 'supervisor']

// 出来状況の表示名（ExecutionListView.vue の STATUS_DISPLAY）。知らないコードは応答の 処理状況名
const STATUS_LABELS = {
  '011': '全部出来',
  '010': '一部出来',
  '032': '取消済（出来有）',
  '034': '取消済（出来有）',
}

// 値が無いときの表示（セル・件数カード）
const EMPTY_CELL = '—'

const CSV_FILENAME = 'executions.csv'
const BOM = '﻿'

const { openList, countOf, rowsOf, settleList, expectListConsistent } = listHelpers({
  path: PATH,
  testIdPrefix: 'executions',
})

/** 表の 1 列ぶんのセル（全行） */
function columnOf(page, column) {
  return rowsOf(page).locator(`td:nth-child(${BASE_COLUMNS.indexOf(column) + 1})`)
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

/** クエリの値が合う GET /executions の応答を待つ */
function waitForList(page, query, value) {
  return waitForApi(page, API_PATH, (url) => url.searchParams.get(query) === value)
}

/**
 * 約定照会を開き、画面が受け取った条件なしの GET /executions の応答を返す。
 * 絞り込みの値はここから読む（テストから API を直接引かない理由はファイル冒頭）
 */
async function openAndCapture(page) {
  const response = waitForApi(page, API_PATH, isUnfiltered)
  await openList(page)
  const res = await response
  expect(res.ok(), `${API_PATH} が ${res.status()} を返した`).toBe(true)
  const body = await res.json()
  return { body, total: await countOf(page), first: body.executions?.[0] ?? null }
}

/** 開いて、0 件ならスキップする */
async function openOrSkip(page) {
  const opened = await openAndCapture(page)
  test.skip(opened.total === 0 || !opened.first, '約定が 0 件なので絞り込みを確かめられない')
  return opened
}

/** 「検索」を押して、条件に合う応答と描画を待つ */
async function submit(page, response) {
  await page.getByTestId('executions-search-submit').click()
  const res = await response
  expect(res.ok(), `${API_PATH} が ${res.status()} を返した`).toBe(true)
  await settleList(page)
}

/** 件数カードの値。'—' なら null */
async function statValue(page, testId, label) {
  const text = ((await page.getByTestId(testId).textContent()) ?? '').replace(label, '').trim()
  return text === EMPTY_CELL ? null : Number(text.replace(/[^0-9]/g, ''))
}

/** 絞り込んだあとの共通の期待値。件数が 1 以上かつ全件以下で、表示行・総約定件数と合う */
async function expectNarrowed(page, total) {
  const filtered = await countOf(page)
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThanOrEqual(total)
  await expect(page.getByTestId('executions-error')).toHaveCount(0)
  expect(await statValue(page, 'executions-summary-count', '総約定件数')).toBe(filtered)

  const shown = Math.min(filtered, PAGE_SIZE)
  await expect(rowsOf(page)).toHaveCount(shown)
  return { filtered, shown }
}

/** URL（画面）のクエリの値 */
function urlQuery(page, name) {
  return new URL(page.url()).searchParams.get(name)
}

/** 「CSV出力」を押し、export-csv のリクエストとダウンロードを待つ */
async function download(page) {
  const request = page.waitForRequest((req) => new URL(req.url()).pathname === CSV_API_PATH)
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('executions-export').click(),
  ])
  return {
    url: new URL((await request).url()),
    name: file.suggestedFilename(),
    text: readFileSync(await file.path(), 'utf8'),
  }
}

/**
 * CSV を行×列に割る。`"` で囲まれた値の中の `,` `""` 改行を扱い、改行は CRLF / LF のどちらでも受ける
 * （実 API の改行コードは openapi.json に書かれていない）。BOM は落とす
 */
function parseCsv(text) {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text
  const records = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (body[i + 1] === '"') {
        field += '"'
        i += 1
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && body[i + 1] === '\n') i += 1
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else field += c
  }
  // 末尾に改行が無いときの最後の行
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}

test.describe('約定照会（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[EXR-01] 開くと条件なしで GET /executions が送られ、件数・一覧・件数カードが食い違わない', async ({
    page,
  }) => {
    const { body } = await openAndCapture(page)

    const total = await expectListConsistent(page, { pageSize: PAGE_SIZE })
    // 件数表示は応答の total、総約定件数は応答の summary から出る。同じ条件の値なので一致する
    expect(body.total).toBe(total)
    expect(await statValue(page, 'executions-summary-count', '総約定件数')).toBe(total)
    const buy = await statValue(page, 'executions-summary-buy', '買い約定')
    const sell = await statValue(page, 'executions-summary-sell', '売り約定')
    expect(buy + sell).toBeLessThanOrEqual(total)
    // 一部出来は注文の件数（ExecutionSummary の 一部出来件数）。約定 1 行は注文 1 件以上に属するので総約定件数以下
    const partial = await statValue(page, 'executions-summary-partial', '一部出来')
    expect(partial).not.toBeNull()
    expect(partial).toBeGreaterThanOrEqual(0)
    expect(partial).toBeLessThanOrEqual(total)
  })

  test('[EXR-02] 売買区分で絞り込むと、実 API へコードで送られ、件数カードと同じ件数が出る', async ({
    page,
  }) => {
    await openAndCapture(page)

    const sellCount = await statValue(page, SIDES.sell.card, SIDES.sell.label)
    const buyCount = await statValue(page, SIDES.buy.card, SIDES.buy.label)
    test.skip(!sellCount && !buyCount, '売り約定・買い約定がどちらも 0 件')
    const side = sellCount ? 'sell' : 'buy'
    const expected = sellCount || buyCount

    await page.getByTestId('executions-side').selectOption({ label: SIDES[side].option })
    await submit(page, waitForList(page, 'side', SIDES[side].code))

    expect(urlQuery(page, 'side')).toBe(side)
    await expect(page.getByTestId('executions-count')).toHaveText(`${expected} 件`)
    const shown = Math.min(expected, PAGE_SIZE)
    // クエリが黙って無視されていれば反対の売買が混ざる
    await expect(columnOf(page, '売買')).toHaveText(Array(shown).fill(SIDES[side].cell))
  })

  test('[EXR-03] 1 行目の銘柄で絞り込むと、その銘柄の約定だけが出る', async ({ page }) => {
    const { total } = await openOrSkip(page)

    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('executions-symbol').fill(symbol)
    await submit(page, waitForList(page, 'symbol', symbol))

    expect(urlQuery(page, 'symbol')).toBe(symbol)
    const { shown } = await expectNarrowed(page, total)
    // 銘柄の列はティッカー（無ければ銘柄コード）。symbol は銘柄コードか Ticker の一致
    await expect(columnOf(page, '銘柄')).toHaveText(Array(shown).fill(symbol))
  })

  test('[EXR-04] 先頭の約定の出来状況で絞り込むと、その出来状況の約定だけが出る', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const code = String(first.処理状況 ?? '')
    // 選択肢はコードマスタ `約定出来状況`（契約提案）から来る。実 API に無ければ選べない
    const select = page.getByTestId('executions-status')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    test.skip(code === '' || !options.includes(code), `出来状況のプルダウンに ${code} が無い`)
    const expectedLabel = STATUS_LABELS[code] ?? (first.処理状況名 || EMPTY_CELL)

    await select.selectOption(code)
    await submit(page, waitForList(page, 'status', code))

    expect(urlQuery(page, 'status')).toBe(code)
    const { shown } = await expectNarrowed(page, total)
    await expect(columnOf(page, '出来状況')).toHaveText(Array(shown).fill(expectedLabel))
  })

  test('[EXR-05] 先頭の約定の約定日で期間を絞ると、実 API へ start_date / end_date が送られる', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const date = /^\d{4}-\d{2}-\d{2}/.exec(String(first.約定日時 ?? ''))?.[0]
    test.skip(!date, `先頭の約定の約定日時が YYYY-MM-DD で始まらない（${first.約定日時}）`)

    await page.getByTestId('executions-date-from').fill(date)
    await page.getByTestId('executions-date-to').fill(date)
    await submit(
      page,
      waitForApi(
        page,
        API_PATH,
        (url) => url.searchParams.get('start_date') === date && url.searchParams.get('end_date') === date,
      ),
    )

    expect(urlQuery(page, 'start_date')).toBe(date)
    expect(urlQuery(page, 'end_date')).toBe(date)
    // 約定日時の列は「MM/DD HH:mm」で年が無いので、行の中身は見ない
    await expectNarrowed(page, total)
  })

  test('[EXR-06] 先頭の約定の部店で絞り込むと、実 API へ branch_code が送られ、エラーにならない', async ({
    page,
  }) => {
    const { total, first } = await openOrSkip(page)

    const branchCode = String(first.部店 ?? '')
    test.skip(branchCode === '', '先頭の約定の部店が空')

    await page.getByTestId('executions-branch-code').fill(branchCode)
    await submit(page, waitForList(page, 'branch_code', branchCode))

    expect(urlQuery(page, 'branch_code')).toBe(branchCode)
    // 表に部店の列は無いので、件数と食い違いだけを見る（他店の指定は 403 になるが、見えている約定の部店なので通る）
    await expectNarrowed(page, total)
  })

  test('[EXR-07] 51 件以上あるとき「次のページ」で 2 ページ目が実 API から読まれる', async ({
    page,
  }) => {
    const { total } = await openAndCapture(page)
    test.skip(total <= PAGE_SIZE, `約定が ${total} 件で 2 ページ目が無い`)

    const response = waitForList(page, 'offset', String(PAGE_SIZE))
    await page
      .getByTestId('executions-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    expect(urlQuery(page, 'offset')).toBe(String(PAGE_SIZE))
    await expect(page.getByTestId('executions-count')).toHaveText(`${total} 件`)
    await expect(rowsOf(page)).toHaveCount(Math.min(total - PAGE_SIZE, PAGE_SIZE))
  })

  test('[EXR-08] 絞り込んだあと「クリア」で条件なしの一覧に戻る', async ({ page }) => {
    const { total } = await openAndCapture(page)

    const sellCount = await statValue(page, SIDES.sell.card, SIDES.sell.label)
    const buyCount = await statValue(page, SIDES.buy.card, SIDES.buy.label)
    test.skip(!sellCount && !buyCount, '売り約定・買い約定がどちらも 0 件')
    const side = sellCount ? 'sell' : 'buy'

    await page.getByTestId('executions-side').selectOption({ label: SIDES[side].option })
    await submit(page, waitForList(page, 'side', SIDES[side].code))

    const response = waitForApi(page, API_PATH, isUnfiltered)
    await page.getByTestId('executions-search-clear').click()
    expect((await response).ok()).toBe(true)
    await settleList(page)

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByTestId('executions-count')).toHaveText(`${total} 件`)
    await expect(page.getByTestId('executions-side')).toHaveValue('')
  })

  test('[EXR-09] 預託先の欄と列が /auth/me のロールに従って出し分けられる', async ({ page }) => {
    // /auth/me は起動時に main.js が引く。goto の前から待ち受ける
    const me = waitForApi(page, AUTH_ME_PATH)
    await openList(page)
    const res = await me
    expect(res.ok(), `${AUTH_ME_PATH} が ${res.status()} を返した`).toBe(true)
    const role = (await res.json())?.ロールコード ?? ''
    const canViewRoute = ROUTE_VIEWER_ROLES.includes(role)

    await expect(page.getByTestId('executions-route')).toHaveCount(canViewRoute ? 1 : 0)
    // 見出しは 0 件でも出るとは限らない（表を出さない）ので、1 件以上のときだけ見る
    if ((await countOf(page)) > 0) {
      await expect(page.getByTestId('executions-table').locator('th')).toHaveText(
        canViewRoute ? [...BASE_COLUMNS, ROUTE_COLUMN] : BASE_COLUMNS,
      )
    }
  })

  test('[EXR-10] 先頭の約定の預託先で絞り込むと、実 API へ route が送られる', async ({ page }) => {
    const { total, first } = await openOrSkip(page)

    const select = page.getByTestId('executions-route')
    test.skip((await select.count()) === 0, '預託先区分が出ないロール')
    // 注文ルートはコードと名称が混在しうる（openapi.json の route の説明）。選択肢にあるコードのときだけ見る
    const code = String(first.注文ルート ?? '')
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value))
    test.skip(code === '' || !options.includes(code), `預託先区分のプルダウンに ${code} が無い`)

    await select.selectOption(code)
    await submit(page, waitForList(page, 'route', code))

    expect(urlQuery(page, 'route')).toBe(code)
    await expectNarrowed(page, total)
  })

  test('[EXR-11] 「CSV出力」で条件なしの全件が BOM 付きで保存され、行数が件数と合う', async ({
    page,
  }) => {
    const { total } = await openOrSkip(page)
    test.skip(total > CSV_LIMIT, `約定が ${total} 件で CSV の上限（${CSV_LIMIT} 件）を超える`)

    const file = await download(page)

    expect(isUnfiltered(file.url), `条件なしの CSV 出力に絞り込みのクエリが載っている`).toBe(true)
    expect(file.name).toBe(CSV_FILENAME)
    expect(file.text.startsWith(BOM)).toBe(true)

    const [header, ...data] = parseCsv(file.text)
    expect(header.length).toBeGreaterThan(0)
    expect(data).toHaveLength(total)

    // 列の並びはバックエンドが決める。約定日時の列があれば昇順（openapi.json の説明「約定日時昇順」）
    const at = header.indexOf('約定日時')
    if (at >= 0) {
      const values = data.map((row) => row[at])
      expect(values).toEqual([...values].sort())
    }
  })

  test('[EXR-12] 1 行目の銘柄で絞り込んだ「CSV出力」は、同じ条件で一覧と同じ行数になる', async ({
    page,
  }) => {
    await openOrSkip(page)

    const symbol = ((await columnOf(page, '銘柄').first().textContent()) ?? '').trim()
    test.skip(symbol === '' || symbol === EMPTY_CELL, '1 行目の銘柄が空')

    await page.getByTestId('executions-symbol').fill(symbol)
    await submit(page, waitForList(page, 'symbol', symbol))
    const filtered = await countOf(page)
    expect(filtered).toBeGreaterThan(0)

    const file = await download(page)

    // 一覧と同じ条件で送られる（ストアが最後に読んだ条件）
    expect(file.url.searchParams.get('symbol')).toBe(symbol)
    const [header, ...data] = parseCsv(file.text)
    expect(data).toHaveLength(filtered)

    const codeAt = header.indexOf('銘柄コード')
    const tickerAt = header.indexOf('Ticker')
    if (codeAt >= 0 || tickerAt >= 0) {
      for (const row of data) {
        expect([row[codeAt], row[tickerAt]], `CSV に ${symbol} 以外の行がある`).toContain(symbol)
      }
    }
  })
})

import { expect, test } from '@playwright/test'
import { noOperationOperator } from '../src/mocks/fixtures/currentOperator'
import { orderInquiryRows } from '../src/mocks/fixtures/orderInquiry'
import { formatJpyUnit, formatQuantity, formatUsd } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'
import {
  COLUMNS,
  INQUIRY_PATH,
  MARKET_SCOPE_LABELS,
  ORDER_TYPE_LABELS,
  SIDE_LABELS,
  cellOf,
  expectedRowIds,
  fixtureRow,
  historyOf,
  latestVersionOf,
  rowOf,
  rowsOf,
  slicesOf,
} from './helpers/orderInquiry'

// シナリオ: docs/e2e/order-inquiry.md（タイトル先頭の [OI-nn] が対応 ID）
// 元注文ごとに 1 行へまとめる一覧と、訂正履歴・自動分割の開閉、検索条件と URL の同期、
// 発注権限での操作の出し分け、訂正・取消の画面への遷移を守る。
// mockApi() は固定の body を返すだけでクエリを解釈しない。絞り込み（OI-10〜13 / 16〜20）は
// クエリを実際に処理する既定ハンドラで検証する。

const AUTH_ME_PATH = '*/api/auth/me'
const SERVER_ERROR = 'サーバーでエラーが発生しました。'

const allRowIds = expectedRowIds(orderInquiryRows)

/*
 * 選択肢のコード → API の status に載る処理状況コード。src/api/orderInquiry.js の STATUS_QUERY の写し
 * （api 層は import.meta.env を辿る api/client.js に依存しており Playwright からは import できない）。
 * 取消済（034）は 032,034、注文エラー（101）は 101,103 に広げて送る。既定モックに 032 / 103 の行は無い
 */
const STATUS_QUERY = { '034': ['032', '034'], 101: ['101', '103'] }

/** 処理状況コードで絞った生の行（既定ハンドラはカンマ区切りのどれかと完全一致で絞る） */
const withStatus = (code) => {
  const codes = STATUS_QUERY[code] ?? [code]
  return orderInquiryRows.filter((row) => codes.includes(row.処理状況))
}

/*
 * 出来状況（画面の名称）→ 処理状況コード。選択肢はコードマスタ 注文照会出来状況
 * （src/mocks/fixtures/codes.js）で、コードは URL の status にそのまま載る（API へは STATUS_QUERY で広げる）。
 * 「取消済」だけは選択肢の名称が「取消済（出来有・無）」で、表の出来状況は「取消済」で始まる。
 */
const EXECUTION_STATUS_CODES = {
  未出来: '000',
  注文中: '003',
  一部出来: '010',
  全部出来: '011',
  取消済: '034',
  注文エラー: '101',
}

/** 画面の行の「注文ID」列を並び順に読む */
async function expectRowIds(page, ids) {
  const rows = rowsOf(page)
  await expect(rows).toHaveCount(ids.length)
  for (const [index, id] of ids.entries()) {
    await expect(cellOf(rows.nth(index), '注文ID')).toContainText(`#${id}`)
  }
}

test.describe('注文照会', () => {
  test('[OI-01] サイドメニューから開くと一覧と件数が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: '注文照会', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
    await expect(page.getByRole('heading', { name: '注文照会', exact: true })).toBeVisible()
    await expect(page.getByTestId('order-inquiry-new-order')).toHaveText('新規注文')
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(
      `${orderInquiryRows.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(allRowIds.length)
    await expect(cellOf(rowsOf(page).first(), '注文ID')).toContainText(`#${allRowIds[0]}`)
  })

  test('[OI-02] 列が画面モックの順に並ぶ', async ({ page }) => {
    await page.goto(INQUIRY_PATH)

    await expect(
      page.getByTestId('order-inquiry-table').getByRole('columnheader'),
    ).toHaveText(COLUMNS)
  })

  test('[OI-03] 1 行目に元注文の内容が整形して表示される', async ({ page }) => {
    const first = fixtureRow(allRowIds[0])
    const slices = slicesOf(first.ID)
    await page.goto(INQUIRY_PATH)

    const row = rowsOf(page).first()
    await expect(row.getByRole('cell')).toHaveText([
      new RegExp(`^#${first.ID}\\s*自動分割 ${slices.length}件$`),
      first.部店,
      String(first.口座番号),
      first.顧客名,
      first.銘柄コード,
      SIDE_LABELS[first.売買区分],
      formatQuantity(first.数量),
      ORDER_TYPE_LABELS[first.指成区分],
      '—', // 成行は価格を持たない
      formatQuantity(first.出来数量),
      formatQuantity(first.有効残数量),
      formatUsd(first.約定代金),
      formatJpyUnit(first.約定代金_JPY),
      MARKET_SCOPE_LABELS[first.発注範囲],
      first.表示状況名,
      '—', // 送信日時は値の出所が決まっていない
      new RegExp(first.受注時刻.slice(0, 5)),
      /訂正\s*取消/,
    ])
    await expect(row.getByTestId('order-inquiry-split-toggle')).toHaveText(
      `自動分割 ${slices.length}件`,
    )
  })

  test('[OI-04] 訂正 1 回の行を開くと原注文の行が出て、もう一度押すと閉じる', async ({ page }) => {
    const ROOT = 38
    const history = historyOf(ROOT)
    expect(history).toHaveLength(1)
    await page.goto(INQUIRY_PATH)

    const toggle = rowOf(page, ROOT).getByTestId('order-inquiry-history-toggle')
    await expect(toggle).toHaveText('+')
    await toggle.click()

    const historyRows = page.getByTestId('order-inquiry-history-row')
    await expect(historyRows).toHaveCount(1)
    await expect(historyRows.first()).toContainText(`#${history[0].ID}`)
    await expect(historyRows.first()).toContainText('原注文（訂正済）')
    await expect(toggle).toHaveText('−')

    await toggle.click()
    await expect(historyRows).toHaveCount(0)
    await expect(toggle).toHaveText('+')
  })

  test('[OI-05] 訂正 2 回の行は古い順に 2 行開き、元注文の行は最新の版を出す', async ({ page }) => {
    const ROOT = 30
    const history = historyOf(ROOT)
    const latest = latestVersionOf(ROOT)
    expect(history).toHaveLength(2)
    await page.goto(INQUIRY_PATH)

    const row = rowOf(page, ROOT)
    await expect(cellOf(row, '数量')).toHaveText(formatQuantity(latest.数量))
    await expect(cellOf(row, '価格')).toHaveText(formatUsd(latest.指値単価))
    await expect(cellOf(row, '出来状況')).toHaveText(latest.表示状況名)

    await row.getByTestId('order-inquiry-history-toggle').click()

    const historyRows = page.getByTestId('order-inquiry-history-row')
    await expect(historyRows).toHaveCount(2)
    await expect(historyRows.nth(0)).toContainText(`#${history[0].ID}`)
    await expect(historyRows.nth(0)).toContainText('原注文（訂正済）')
    await expect(historyRows.nth(1)).toContainText(`#${history[1].ID}`)
    await expect(historyRows.nth(1)).toContainText('第1回訂正')
  })

  test('[OI-06] 自動分割を開くと子注文の明細が並ぶ', async ({ page }) => {
    const ROOT = 35
    const slices = slicesOf(ROOT)
    await page.goto(INQUIRY_PATH)

    const toggle = rowOf(page, ROOT).getByTestId('order-inquiry-split-toggle')
    await toggle.click()

    const detail = page.getByTestId('order-inquiry-split-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('スライス基準による自動分割')
    const sliceRows = detail.getByRole('row')
    // 見出し行 + 子注文の行
    await expect(sliceRows).toHaveCount(slices.length + 1)
    for (const [index, slice] of slices.entries()) {
      const cells = sliceRows.nth(index + 1).getByRole('cell')
      await expect(cells.nth(0)).toHaveText(`${index + 1} / ${slices.length}`)
      await expect(cells.nth(1)).toHaveText(`#${slice.ID}`)
    }
    await expect(toggle).toHaveText('自動分割を閉じる')
  })

  test('[OI-07] 操作列のボタンは最新の版の状況で出し分けられる', async ({ page }) => {
    await page.goto(INQUIRY_PATH)

    const partial = rowOf(page, 35) // 一部出来
    await expect(partial.getByTestId('order-inquiry-amend')).toHaveText('訂正')
    await expect(partial.getByTestId('order-inquiry-cancel')).toHaveText('取消')

    const failed = rowOf(page, 40) // 注文エラー
    await expect(failed.getByTestId('order-inquiry-cancel')).toBeVisible()
    await expect(failed.getByTestId('order-inquiry-amend')).toHaveCount(0)

    for (const id of [41, 39]) {
      // 全部出来 / 取消済
      const row = rowOf(page, id)
      await expect(row).toBeVisible()
      await expect(row.getByTestId('order-inquiry-amend')).toHaveCount(0)
      await expect(row.getByTestId('order-inquiry-cancel')).toHaveCount(0)
    }
  })

  test('[OI-08] 注文エラーの出来状況にホバーすると理由が読める', async ({ page }) => {
    const failed = fixtureRow(40)
    await page.goto(INQUIRY_PATH)

    const status = cellOf(rowOf(page, failed.ID), '出来状況').getByText(failed.表示状況名, {
      exact: true,
    })
    await status.hover()
    // 理由はブラウザ標準のツールチップ（title）で出す。headless では描かれないので属性で見る
    await expect(status).toHaveAttribute('title', failed.エラー内容)
  })

  test('[OI-09] 取消済（出来有）の行は数量の下に取消株数を添える', async ({ page }) => {
    const canceled = fixtureRow(39)
    await page.goto(INQUIRY_PATH)

    const row = rowOf(page, canceled.ID)
    await expect(cellOf(row, '出来状況')).toHaveText(canceled.表示状況名)
    await expect(cellOf(row, '数量')).toHaveText(
      new RegExp(
        `^${formatQuantity(canceled.数量)}\\s*取消 ${formatQuantity(canceled.取消数量)}$`,
      ),
    )
  })

  test('[OI-10] 部店コードで検索すると URL に載り、その部店の注文だけになる', async ({ page }) => {
    const BRANCH = '123'
    const hits = orderInquiryRows.filter((row) => row.部店 === BRANCH)
    await page.goto(INQUIRY_PATH)
    await expect(rowsOf(page)).toHaveCount(allRowIds.length)

    await page.getByTestId('order-inquiry-branch-code').fill(BRANCH)
    await page.getByTestId('order-inquiry-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`branch_code=${BRANCH}`))
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, expectedRowIds(hits))
  })

  test('[OI-11] 銘柄コードで検索すると訂正の連なりが 1 行にまとまる', async ({ page }) => {
    const SYMBOL = 'NVDA'
    const hits = orderInquiryRows.filter((row) => row.銘柄コード === SYMBOL)
    const ids = expectedRowIds(hits)
    expect(ids).toHaveLength(1)
    await page.goto(INQUIRY_PATH)

    await page.getByTestId('order-inquiry-symbol').fill(SYMBOL)
    await page.getByTestId('order-inquiry-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`symbol=${SYMBOL}`))
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, ids)
    await expect(cellOf(rowsOf(page).first(), '注文ID')).toContainText(
      `訂正 ${historyOf(ids[0]).length}回`,
    )
  })

  test('[OI-12] 「クリア」で検索条件と URL のクエリが消え、全件に戻る', async ({ page }) => {
    await page.goto(`${INQUIRY_PATH}?branch_code=123`)
    await expect(page.getByTestId('order-inquiry-branch-code')).toHaveValue('123')

    await page.getByTestId('order-inquiry-search-clear').click()

    await expect(page).toHaveURL(new RegExp(`${INQUIRY_PATH}$`))
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(
      `${orderInquiryRows.length} 件`,
    )
    await expect(rowsOf(page)).toHaveCount(allRowIds.length)
    await expect(page.getByTestId('order-inquiry-branch-code')).toHaveValue('')
  })

  test('[OI-13] 該当する注文が無いと空の表示になり、検索カードは残る', async ({ page }) => {
    await page.goto(`${INQUIRY_PATH}?branch_code=999`)

    await expect(page.getByTestId('order-inquiry-empty')).toHaveText('注文が見つかりませんでした')
    await expect(page.getByTestId('order-inquiry-table')).toHaveCount(0)
    await expect(page.getByTestId('order-inquiry-search')).toBeVisible()
  })

  test('[OI-14] 一覧の取得に失敗するとエラーと再試行が出て、検索カードは残る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/orders', status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(INQUIRY_PATH)

    const error = page.getByTestId('order-inquiry-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('order-inquiry-table')).toHaveCount(0)
    await expect(page.getByTestId('order-inquiry-search')).toBeVisible()
  })

  test('[OI-15] ヘッダの「新規注文」で顧客検索へ移る', async ({ page }) => {
    await page.goto(INQUIRY_PATH)

    await page.getByTestId('order-inquiry-new-order').click()

    // URL は遷移先（遅延 import の CustomerSearchView）を読み終えてから変わる。
    // 並列実行で dev サーバの初回変換が重なると 5 秒を越えることがあるので猶予を延ばす
    await expect(page).toHaveURL(/\/customers\/search$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: '顧客検索', exact: true })).toBeVisible()
  })

  test('[OI-16] 出来状況「注文中」で検索すると URL に載り、注文中の行だけになる', async ({
    page,
  }) => {
    const LABEL = '注文中'
    const CODE = EXECUTION_STATUS_CODES[LABEL]
    const hits = withStatus(CODE)
    const ids = expectedRowIds(hits)
    await page.goto(INQUIRY_PATH)
    await expect(rowsOf(page)).toHaveCount(allRowIds.length)

    await page.getByTestId('order-inquiry-status').selectOption({ label: LABEL })
    await page.getByTestId('order-inquiry-search-submit').click()

    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe(CODE)
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, ids)
    for (const index of ids.keys()) {
      await expect(cellOf(rowsOf(page).nth(index), '出来状況')).toHaveText(LABEL)
    }
  })

  test('[OI-17] ?status=010（一部出来）を開くと当たった子注文だけが自動分割に残る', async ({
    page,
  }) => {
    const CODE = EXECUTION_STATUS_CODES.一部出来
    const hits = withStatus(CODE)
    const ids = expectedRowIds(hits)
    expect(ids).toHaveLength(1)
    const hitSlices = hits.filter((row) => row.注文種別 === 'SLICE_CHILD')
    await page.goto(`${INQUIRY_PATH}?status=${CODE}`)

    await expect(page.getByTestId('order-inquiry-status')).toHaveValue(CODE)
    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, ids)
    await expect(rowsOf(page).first().getByTestId('order-inquiry-split-toggle')).toHaveText(
      `自動分割 ${hitSlices.length}件`,
    )
  })

  test('[OI-18] ?status=034（取消済）を開くと取消済の行だけが元注文ごとにまとまる', async ({
    page,
  }) => {
    const CODE = EXECUTION_STATUS_CODES.取消済
    const hits = withStatus(CODE)
    const ids = expectedRowIds(hits)
    await page.goto(`${INQUIRY_PATH}?status=${CODE}`)

    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, ids)
    for (const index of ids.keys()) {
      await expect(cellOf(rowsOf(page).nth(index), '出来状況')).toHaveText(/^取消済/)
    }

    // #30 は訂正で取り消された版（#33）だけが当たり、その版の内容と「訂正 1回」を出す
    const amendedCanceled = hits.filter((row) => (row.元注文ID ?? row.ID) === 30)
    const shown = amendedCanceled.reduce((a, b) => (b.ID > a.ID ? b : a))
    const row = rowOf(page, 30)
    await expect(cellOf(row, '注文ID')).toContainText(`訂正 ${amendedCanceled.length - 1}回`)
    await expect(cellOf(row, '価格')).toHaveText(formatUsd(shown.指値単価))
  })

  test('[OI-19] ?status=101（注文エラー）を開くと注文エラーの行だけになる', async ({ page }) => {
    const LABEL = '注文エラー'
    const hits = withStatus(EXECUTION_STATUS_CODES[LABEL])
    const ids = expectedRowIds(hits)
    await page.goto(`${INQUIRY_PATH}?status=${EXECUTION_STATUS_CODES[LABEL]}`)

    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, ids)
    await expect(cellOf(rowsOf(page).first(), '出来状況')).toHaveText(LABEL)
  })

  test('[OI-20] ?status=000（未出来）を開くと親の当たらない子注文は単独の行になる', async ({
    page,
  }) => {
    const CODE = EXECUTION_STATUS_CODES.未出来
    const hits = withStatus(CODE)
    const ids = expectedRowIds(hits)
    // 前提: 子注文 #45 だけが当たるまとまり（親 #35 は一部出来）と、#30 の最新版 #36 が当たる
    expect(ids).toEqual([45, 30])
    await page.goto(`${INQUIRY_PATH}?status=${CODE}`)

    await expect(page.getByTestId('order-inquiry-count')).toHaveText(`${hits.length} 件`)
    await expectRowIds(page, ids)
    await expect(rowsOf(page).getByTestId('order-inquiry-split-toggle')).toHaveCount(0)
  })

  test('[OI-21] 発注権限が無いと「発注権限なし」と「閲覧のみ」になる', async ({ page }) => {
    expect(noOperationOperator.権限.order).toBe(false)
    await mockApi(page, [{ path: AUTH_ME_PATH, body: noOperationOperator }])
    await page.goto(INQUIRY_PATH)

    await expect(page.getByTestId('order-inquiry-no-permission')).toHaveText('発注権限なし')
    await expect(page.getByTestId('order-inquiry-new-order')).toHaveCount(0)

    await expect(rowsOf(page)).toHaveCount(allRowIds.length)
    await expect(page.getByTestId('order-inquiry-view-only')).toHaveCount(allRowIds.length)
    for (const index of allRowIds.keys()) {
      await expect(cellOf(rowsOf(page).nth(index), '操作')).toHaveText('閲覧のみ')
    }
    await expect(page.getByTestId('order-inquiry-amend')).toHaveCount(0)
    await expect(page.getByTestId('order-inquiry-cancel')).toHaveCount(0)
  })

  test('[OI-22] 「訂正」は最新の版の訂正画面へ移る', async ({ page }) => {
    const ROOT = 30
    const latest = latestVersionOf(ROOT)
    expect(latest.ID).not.toBe(ROOT)
    await page.goto(INQUIRY_PATH)

    await rowOf(page, ROOT).getByTestId('order-inquiry-amend').click()

    await expect(page).toHaveURL(new RegExp(`/orders/${latest.ID}/amend$`))
    await expect(page.getByRole('heading', { name: '外株注文訂正', exact: true })).toBeVisible()
  })

  test('[OI-23] 「取消」は最新の版の取消画面へ移る', async ({ page }) => {
    const ROOT = 38
    const latest = latestVersionOf(ROOT)
    expect(latest.ID).not.toBe(ROOT)
    await page.goto(INQUIRY_PATH)

    await rowOf(page, ROOT).getByTestId('order-inquiry-cancel').click()

    await expect(page).toHaveURL(new RegExp(`/orders/${latest.ID}/cancel$`))
    await expect(page.getByRole('heading', { name: '注文取消', exact: true })).toBeVisible()
  })
})

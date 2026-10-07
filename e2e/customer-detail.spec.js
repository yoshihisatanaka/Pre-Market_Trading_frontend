import { expect, test } from '@playwright/test'
import { calculationMessages, FEE_PATTERNS } from '../src/mocks/fixtures/calculations'
import { noOperationOperator } from '../src/mocks/fixtures/currentOperator'
import { customers } from '../src/mocks/fixtures/customers'
import { holdings } from '../src/mocks/fixtures/holdings'
import { orderInquiryRows } from '../src/mocks/fixtures/orderInquiry'
import { formatJpyUnit, formatUsdUnit } from '../src/utils/format'
import { mockApi } from './helpers/mockApi'
import { COLUMNS as INQUIRY_COLUMNS, expectedRowIds } from './helpers/orderInquiry'

// シナリオ: docs/e2e/customer-detail.md（タイトル先頭の [CDT-nn] が対応 ID）
// 顧客詳細（枠 = 顧客カードとタブ、子 = 外株預り / 注文照会 / 仮計算）。顧客・預り・注文の 3 か所の 4 状態、
// タブと URL の同期、新規注文・仮計算への引き継ぎ（入力欄に値が入るまで）、発注権限での出し分けを守る。
// mockApi() は固定の body を返すだけでクエリを解釈しない。注文照会タブの絞り込み（CDT-26〜30）は
// クエリを実際に処理する既定ハンドラで検証する。

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

const customerById = (id) => {
  const row = customers.find((candidate) => candidate.ID === id)
  if (!row) throw new Error(`顧客マスタのフィクスチャに ID ${id} がありません`)
  return row
}

/** 預りも注文もある顧客（山田 太郎） */
const YAMADA = customerById(1)
/** 保有も注文も無い顧客 */
const NO_HOLDINGS = customerById(3)
/** 全取引停止の顧客 */
const SUSPENDED = customerById(5)
/** 法人（年齢なし） */
const CORPORATE = customerById(9)
/** 顧客マスタに居ない ID（404） */
const MISSING_ID = 9999

const yamadaHoldings = holdings.filter((row) => row.口座番号 === YAMADA.口座番号)
const holdingOf = (ticker) => {
  const row = yamadaHoldings.find((candidate) => candidate.ティッカー === ticker)
  if (!row) throw new Error(`預りのフィクスチャに口座 ${YAMADA.口座番号} の ${ticker} がありません`)
  return row
}
const AAPL = holdingOf('AAPL')
const MSFT = holdingOf('MSFT')
const NVDA = holdingOf('NVDA')
const TSLA = holdingOf('TSLA')

const yamadaOrders = orderInquiryRows.filter((row) => row.口座番号 === YAMADA.口座番号)

/** 「＋ 新規注文」・タブの「注文入力」が引き継ぐクエリ（src/utils/orderEntryQuery.js の契約） */
const CUSTOMER_QUERY = {
  branch_code: YAMADA.部店コード,
  account_number: String(YAMADA.口座番号),
}

/*
 * 預りの特定預り区分 → 注文の預り区分（URL の deposit）と、新規注文での表示名。
 * src/utils/orderEntryQuery.js の toDepositCategory と src/utils/orderEntryOptions.js の
 * DEPOSIT_CATEGORY_OPTIONS の再掲（向きが逆なので、実装をなぞらず期待値として書く）。
 */
const DEPOSIT_FOR = {
  1: { query: '0', label: '特定' }, // 特定 → 特定
  0: { query: '1', label: '一般' }, // 非特定 → 一般
  6: { query: '6', label: '成長投資枠' },
}

/** 外株預りの表の列（src/views/CustomerSummaryView.vue の columns と同じ並び） */
const HOLDING_COLUMNS = [
  'ティッカー',
  '銘柄コード',
  '銘柄名',
  '数量',
  '預り区分',
  '参考単価（USD）',
  '参考為替（USD/JPY）',
  '取得金額／評価額（円）',
  '評価損益／評価損益率',
  'CA',
  '操作',
]

/** 注文照会タブの表の列。注文照会の列から顧客を特定する 3 列を外したもの */
const CUSTOMER_COLUMNS = ['部店', '口座番号', '顧客名']
const ORDER_COLUMNS = INQUIRY_COLUMNS.filter((column) => !CUSTOMER_COLUMNS.includes(column))

/** 符号付きの円（src/utils/profitLoss.js の書式。負号は U+2212） */
function signedJpy(value) {
  if (value > 0) return `+${formatJpyUnit(value)}`
  if (value < 0) return `−${formatJpyUnit(-value)}`
  return formatJpyUnit(0)
}

/** 符号付きの率。フィクスチャは '13.58%' の形の文字列 */
function signedPercent(text) {
  const value = Number(text.replace('%', ''))
  if (value > 0) return `+${value.toFixed(2)}%`
  if (value < 0) return `−${Math.abs(value).toFixed(2)}%`
  return '0.00%'
}

const sum = (values) => values.reduce((total, value) => total + value, 0)

const summaryPath = (id) => `/customers/${id}/summary`
const ordersPath = (id) => `/customers/${id}/orders`
const calculationsPath = (id) => `/customers/${id}/calculations`

/** 外株預りの表の行。data-table-row は全画面共通の名前なのでこの画面の表にスコープを切る */
function holdingRows(page) {
  return page.getByTestId('customer-holdings-table').getByTestId('data-table-row')
}

/** ティッカーで預りの行を引く（ティッカーはほかの列に現れない） */
function holdingRow(page, holding) {
  return holdingRows(page).filter({ hasText: holding.ティッカー })
}

function holdingCell(row, column) {
  return row.locator('td').nth(HOLDING_COLUMNS.indexOf(column))
}

/** 注文照会タブの元注文の行 */
function orderRows(page) {
  return page.getByTestId('customer-orders-table').getByTestId('order-inquiry-row')
}

async function expectOrderRowIds(page, ids) {
  const rows = orderRows(page)
  await expect(rows).toHaveCount(ids.length)
  for (const [index, id] of ids.entries()) {
    await expect(rows.nth(index).getByRole('cell').first()).toContainText(`#${id}`)
  }
}

function queryOf(page) {
  return Object.fromEntries(new URL(page.url()).searchParams)
}

/** 切り替えボタン（新規注文・仮計算の売買、新規注文の預り区分）が選ばれているか */
function toggleButton(page, testId, name) {
  return page.getByTestId(testId).getByRole('button', { name, exact: true })
}

/** 外株預りを開き、預りの表が出るまで待つ */
async function openSummary(page, id = YAMADA.ID) {
  await page.goto(summaryPath(id))
  await expect(page.getByTestId('customer-info-bar')).toBeVisible()
}

/** 顧客詳細の注文入力タブ（引き継ぎのクエリ付き） */
const ORDER_ENTRY_URL = new RegExp(`/customers/${YAMADA.ID}/order-entry\\?`)

/**
 * 注文入力タブに移り、顧客カードとタブを残したまま新規注文の入力フォームが出て、
 * 部店・口座番号が引き継がれている
 */
async function expectOrderEntryCustomer(page) {
  await expect(page).toHaveURL(ORDER_ENTRY_URL)
  await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
  await expect(page.getByTestId('customer-detail-tab-order-entry')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByTestId('order-entry-form')).toBeVisible()
  await expect(page.getByTestId('order-entry-branch')).toHaveValue(YAMADA.部店コード)
  await expect(page.getByTestId('order-entry-account')).toHaveValue(String(YAMADA.口座番号))
  await expect(page.getByTestId('order-entry-customer-name')).toHaveText(YAMADA.顧客名)
}

/** 仮計算の入力（CDT-39〜44 で共通） */
const CALC_QUANTITY = 10
const CALC_UNIT_PRICE = '230.5'

/** 入力不備の文言（src/utils/calculationForm.js の MESSAGES と numberFieldError の再掲） */
const CALC_MESSAGES = {
  symbolRequired: '銘柄コード／ティッカーを入力してください。',
  quantity: '数量は9桁以内の1株以上で入力してください。',
  unitPrice: '単価を入力してください。',
}

/*
 * AAPL（特定）を 10 株・230.5 ドルで売ったときの明細（見出し → 値）。
 * 既定モック（src/mocks/fixtures/calculations.js の buildCalculationResponse）で計算した値を画面で確かめたもの。
 * 計算は浮動小数で末尾の桁を保証しないので、フィクスチャから組み立て直さずに直書きする。
 */
const AAPL_SELL_ROWS = {
  外貨約定代金: '2,305.00 ドル',
  '現地費用合計（手数料は自動）': '2.36 ドル',
  '取引所税（自動）': '0.05 ドル',
  '適用為替（為替 ± スプレッド）': '149.75 円/USD',
  円換算精算金額: '344,821 円',
  国内手数料: '1,551 円',
  消費税: '155 円',
}

/** 仮計算の結果の明細行の見出しと値 */
function calcRowLabels(page) {
  return page.getByTestId('customer-calc-result-rows').locator('dt')
}
function calcRowValues(page) {
  return page.getByTestId('customer-calc-result-rows').locator('dd')
}

/**
 * 仮計算の入力欄を埋めて「仮計算を実行」を押す。渡さなかった項目は今の値のまま。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ symbol?: string, side?: string, deposit?: string, quantity?: number, unitPrice?: string, feePattern?: string }} input
 *   side / deposit は画面の表示名（「売り」「成長投資枠」など）
 */
async function runCalculation(page, { symbol, side, deposit, quantity, unitPrice, feePattern }) {
  if (symbol !== undefined) await page.getByTestId('customer-calc-symbol').fill(symbol)
  if (side !== undefined) await toggleButton(page, 'customer-calc-side', side).click()
  if (deposit !== undefined) {
    await page.getByTestId('customer-calc-deposit').selectOption({ label: deposit })
  }
  if (quantity !== undefined) {
    await page.getByTestId('customer-calc-quantity').fill(String(quantity))
  }
  if (unitPrice !== undefined) await page.getByTestId('customer-calc-unit-price').fill(unitPrice)
  if (feePattern !== undefined) {
    await page.getByTestId('customer-calc-fee-pattern').selectOption({ label: feePattern })
  }
  await page.getByTestId('customer-calc-submit').click()
}

/** フィクスチャがシナリオの前提を満たしているか（変わったらここで気づく） */
test.beforeAll(() => {
  expect(YAMADA.顧客名).toBe('山田 太郎')
  expect(YAMADA.コンプラランク).toBe('A')
  expect(YAMADA.取引停止区分_全取引).toBe(0)
  expect(Number(YAMADA.年齢)).toBeLessThan(85)
  expect(SUSPENDED.取引停止区分_全取引).toBe(1)
  expect(CORPORATE.年齢).toBe('')
  expect(customers.some((row) => row.ID === MISSING_ID)).toBe(false)
  expect(holdings.some((row) => row.口座番号 === NO_HOLDINGS.口座番号)).toBe(false)
  expect(orderInquiryRows.some((row) => row.口座番号 === NO_HOLDINGS.口座番号)).toBe(false)
  expect(AAPL.評価損益).toBeGreaterThan(0)
  expect(MSFT.評価損益).toBeLessThan(0)
  expect(MSFT.売却不可区分).toBe(1)
  expect(TSLA.評価損益).toBe(0)
  expect(TSLA.CA).toBeTruthy()
  expect(yamadaHoldings.filter((row) => row.CA)).toHaveLength(1)
  expect(NVDA.預り売買区分).toBe('6')
  expect(TSLA.預り売買区分).toBe('0')
  expect(AAPL.預り売買区分).toBe('1')
})

test.describe('顧客詳細 顧客カードとタブ', () => {
  test('[CDT-01] 顧客検索の顧客名から入ると外株預りが開く', async ({ page }) => {
    await page.goto('/customers/search')
    await page.getByTestId('customer-search-account-number').fill(String(YAMADA.口座番号))
    await page.getByTestId('customer-search-search-submit').click()

    await page.getByTestId(`customer-search-detail-${YAMADA.ID}`).click()

    await expect(page).toHaveURL(new RegExp(`${summaryPath(YAMADA.ID)}$`))
    await expect(page.getByRole('heading', { name: '顧客詳細', exact: true })).toBeVisible()
    await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
  })

  test('[CDT-02] /customers/:id だけを開くと外株預りへ回る', async ({ page }) => {
    await page.goto(`/customers/${YAMADA.ID}`)

    await expect(page).toHaveURL(new RegExp(`${summaryPath(YAMADA.ID)}$`))
    await expect(page.getByTestId('customer-detail-tab-summary')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByTestId('customer-detail-tab-orders')).not.toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('[CDT-03] 顧客カードに顧客の属性と預り金が表示される', async ({ page }) => {
    await openSummary(page)

    await expect(page.getByTestId('customer-info-branch')).toHaveText(YAMADA.部店コード)
    await expect(page.getByTestId('customer-info-account')).toHaveText(String(YAMADA.口座番号))
    await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
    await expect(page.getByTestId('customer-info-kana')).toHaveText(YAMADA.顧客名カナ)
    await expect(page.getByTestId('customer-info-age')).toHaveText(`${YAMADA.年齢}歳`)
    await expect(page.getByTestId('customer-info-elderly')).toHaveCount(0)
    await expect(page.getByTestId('customer-info-restriction')).toHaveText('制限なし')
    await expect(page.getByTestId('customer-info-policy')).toHaveText(YAMADA.投資方針名)
    await expect(page.getByTestId('customer-info-compliance')).toContainText(YAMADA.コンプラランク)
    await expect(page.getByTestId('customer-info-compliance-caution')).toHaveText('要注意')
    await expect(page.getByTestId('customer-info-cash-jpy')).toHaveText(
      formatJpyUnit(YAMADA.円貨預り金),
    )
    await expect(page.getByTestId('customer-info-cash-usd')).toHaveText(
      formatUsdUnit(YAMADA.外貨預り金),
    )
    await expect(page.getByTestId('customer-info-growth-quota')).toHaveText(
      formatJpyUnit(YAMADA.NISA買付可能額_当年),
    )
  })

  test('[CDT-04] 顧客カードの米国株評価額と評価損益は預りの合計', async ({ page }) => {
    const valueJpy = sum(yamadaHoldings.map((row) => row.評価額_JPY))
    const profitLoss = sum(yamadaHoldings.map((row) => row.評価損益))
    expect(profitLoss).toBeGreaterThan(0)

    await openSummary(page)

    await expect(page.getByTestId('customer-info-valuation')).toHaveText(formatJpyUnit(valueJpy))
    await expect(page.getByTestId('customer-info-profit-loss')).toHaveText(signedJpy(profitLoss))
  })

  test('[CDT-05] 全取引停止の顧客は取引規制が「全取引停止」', async ({ page }) => {
    await openSummary(page, SUSPENDED.ID)

    await expect(page.getByTestId('customer-info-name')).toHaveText(SUSPENDED.顧客名)
    await expect(page.getByTestId('customer-info-restriction')).toHaveText('全取引停止')
  })

  test('[CDT-06] 法人の顧客は年齢が「—」', async ({ page }) => {
    await openSummary(page, CORPORATE.ID)

    await expect(page.getByTestId('customer-info-name')).toHaveText(CORPORATE.顧客名)
    await expect(page.getByTestId('customer-info-age')).toHaveText('—')
  })

  test('[CDT-07] 居ない顧客は「見つかりません」と顧客検索へ戻るリンクを出す', async ({ page }) => {
    await page.goto(summaryPath(MISSING_ID))

    const notFound = page.getByTestId('customer-detail-not-found')
    await expect(notFound).toContainText('該当する顧客が見つかりません。')
    await expect(page.getByTestId('customer-info-bar')).toHaveCount(0)
    await expect(page.getByTestId('customer-detail-tabs')).toHaveCount(0)

    await page.getByTestId('customer-detail-back-to-search').click()
    await expect(page).toHaveURL(/\/customers\/search$/)
  })

  test('[CDT-08] 顧客の取得が失敗するとエラーと再試行を出す', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/masters/customers/:id', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(summaryPath(YAMADA.ID))

    await expect(page.getByTestId('customer-detail-error')).toContainText(SERVER_ERROR)
    await expect(page.getByTestId('customer-detail-retry')).toBeVisible()
    await expect(page.getByTestId('customer-info-bar')).toHaveCount(0)
    await expect(page.getByTestId('customer-detail-tabs')).toHaveCount(0)
  })

  test('[CDT-09] 顧客を読む間は読み込み中を出し、読み終えると顧客カードを出す', async ({
    page,
  }) => {
    // ?mockDelay=<ミリ秒> を付けた URL だけ /api/* の応答が遅れる（src/mocks/handlers/index.js）
    await page.goto(`${summaryPath(YAMADA.ID)}?mockDelay=1500`)

    await expect(page.getByTestId('customer-detail-loading')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('customer-info-bar')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('customer-detail-loading')).toHaveCount(0)
  })

  test('[CDT-23] タブを押すと URL と選択中のタブが変わり、顧客カードは残る', async ({ page }) => {
    await openSummary(page)
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)

    await page.getByTestId('customer-detail-tab-orders').click()
    await expect(page).toHaveURL(new RegExp(`${ordersPath(YAMADA.ID)}$`))
    await expect(page.getByTestId('customer-detail-tab-orders')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
    await expect(page.getByTestId('customer-orders-table')).toBeVisible()

    await page.getByTestId('customer-detail-tab-summary').click()
    await expect(page).toHaveURL(new RegExp(`${summaryPath(YAMADA.ID)}$`))
    await expect(page.getByTestId('customer-detail-tab-summary')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)
  })
})

test.describe('顧客詳細 外株預り', () => {
  test('[CDT-10] 保有銘柄の件数と行が表示される', async ({ page }) => {
    await openSummary(page)

    await expect(page.getByTestId('customer-holdings-count')).toHaveText(
      `${yamadaHoldings.length} 銘柄`,
    )
    const rows = holdingRows(page)
    await expect(rows).toHaveCount(yamadaHoldings.length)
    for (const [index, holding] of yamadaHoldings.entries()) {
      await expect(holdingCell(rows.nth(index), 'ティッカー')).toHaveText(holding.ティッカー)
    }
  })

  test('[CDT-11] 保有の無い顧客は「保有外株なし」を出し、評価額は 0 円', async ({ page }) => {
    await openSummary(page, NO_HOLDINGS.ID)

    await expect(page.getByTestId('customer-holdings-empty')).toHaveText('保有外株なし')
    await expect(page.getByTestId('customer-holdings-table')).toHaveCount(0)
    await expect(page.getByTestId('customer-info-valuation')).toHaveText(formatJpyUnit(0))
  })

  test('[CDT-12] 預りの取得が失敗すると預りの欄にエラーを出し、顧客カードは残る', async ({
    page,
  }) => {
    await mockApi(page, [{ path: '*/api/holdings', status: 500, body: { detail: SERVER_ERROR } }])
    await openSummary(page)

    const error = page.getByTestId('customer-holdings-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('customer-holdings-table')).toHaveCount(0)
    await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
    await expect(page.getByTestId('customer-info-valuation')).toHaveText('—')
  })

  test('[CDT-13] 預りを読む間は預りの欄に読み込み中を出す', async ({ page }) => {
    await page.goto(`${summaryPath(YAMADA.ID)}?mockDelay=1500`)

    await expect(page.getByTestId('customer-info-bar')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('customer-holdings-loading')).toBeVisible()
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length, { timeout: 10_000 })
    await expect(page.getByTestId('customer-holdings-loading')).toHaveCount(0)
  })

  test('[CDT-14] CA 発生中の銘柄があると警告を出し、その行にだけ印を付ける', async ({ page }) => {
    await openSummary(page)
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)

    await expect(page.getByTestId('customer-holdings-ca-warning')).toContainText(
      'CA（コーポレートアクション）発生中の銘柄があります。',
    )
    await expect(page.getByTestId('customer-holdings-ca-mark')).toHaveCount(1)
    await expect(holdingRow(page, TSLA).getByTestId('customer-holdings-ca-mark')).toHaveCount(1)
    await expect(holdingCell(holdingRow(page, TSLA), 'CA')).toHaveText(TSLA.CA)
    await expect(holdingCell(holdingRow(page, AAPL), 'CA')).toHaveText('—')
  })

  test('[CDT-15] CA の無い顧客には警告を出さない', async ({ page }) => {
    await openSummary(page, NO_HOLDINGS.ID)
    await expect(page.getByTestId('customer-holdings-empty')).toBeVisible()

    await expect(page.getByTestId('customer-holdings-ca-warning')).toHaveCount(0)
  })

  test('[CDT-16] 評価損益は符号付きで、益と損で色が違う', async ({ page }) => {
    await openSummary(page)
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)

    for (const holding of [AAPL, MSFT, TSLA]) {
      const cell = holdingCell(holdingRow(page, holding), '評価損益／評価損益率')
      await expect(cell).toContainText(signedJpy(holding.評価損益))
      await expect(cell).toContainText(signedPercent(holding.評価損益率))
    }

    // 色は CSS クラス名ではなく「見えかた」で比べる
    const colorOf = (holding) =>
      holdingCell(holdingRow(page, holding), '評価損益／評価損益率')
        .locator('div')
        .first()
        .evaluate((el) => getComputedStyle(el).color)
    expect(await colorOf(AAPL)).not.toBe(await colorOf(MSFT))
  })

  test('[CDT-17] 売却不可の明細は「売り」が押せない', async ({ page }) => {
    await openSummary(page)
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)

    await expect(holdingRow(page, MSFT).getByTestId('customer-holdings-sell')).toBeDisabled()
    for (const holding of [AAPL, NVDA, TSLA]) {
      const sell = holdingRow(page, holding).getByTestId('customer-holdings-sell')
      await expect(sell).toBeEnabled()
      await expect(sell).toHaveAttribute('href', ORDER_ENTRY_URL)
    }
    await expect(page.getByTestId('customer-holdings-buy')).toHaveCount(yamadaHoldings.length)
    for (const holding of yamadaHoldings) {
      await expect(holdingRow(page, holding).getByTestId('customer-holdings-buy')).toHaveAttribute(
        'href',
        ORDER_ENTRY_URL,
      )
    }
  })

  test('[CDT-18] 「買い」で新規注文へ顧客・銘柄・売買・預り区分を引き継ぐ', async ({ page }) => {
    const deposit = DEPOSIT_FOR[AAPL.預り売買区分]

    await openSummary(page)
    await holdingRow(page, AAPL).getByTestId('customer-holdings-buy').click()

    await expectOrderEntryCustomer(page)
    expect(queryOf(page)).toEqual({
      ...CUSTOMER_QUERY,
      ticker: AAPL.ティッカー,
      side: 'buy',
      deposit: deposit.query,
    })
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(AAPL.ティッカー)
    await expect(toggleButton(page, 'order-entry-side', '買い')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(toggleButton(page, 'order-entry-deposit-category', deposit.label)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('[CDT-19] 非特定の「売り」は売りと預り区分「一般」を引き継ぐ', async ({ page }) => {
    const deposit = DEPOSIT_FOR[TSLA.預り売買区分]

    await openSummary(page)
    await holdingRow(page, TSLA).getByTestId('customer-holdings-sell').click()

    await expectOrderEntryCustomer(page)
    expect(queryOf(page)).toEqual({
      ...CUSTOMER_QUERY,
      ticker: TSLA.ティッカー,
      side: 'sell',
      deposit: deposit.query,
    })
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(TSLA.ティッカー)
    await expect(toggleButton(page, 'order-entry-side', '売り')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(toggleButton(page, 'order-entry-deposit-category', deposit.label)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('[CDT-20] 成長投資枠の「買い」は預り区分を引き継がない', async ({ page }) => {
    await openSummary(page)
    await holdingRow(page, NVDA).getByTestId('customer-holdings-buy').click()

    await expectOrderEntryCustomer(page)
    expect(queryOf(page)).toEqual({ ...CUSTOMER_QUERY, ticker: NVDA.ティッカー, side: 'buy' })
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue(NVDA.ティッカー)
    await expect(toggleButton(page, 'order-entry-side', '買い')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 新規注文の既定（src/utils/orderEntryOptions.js の ORDER_FORM_DEFAULTS）は「特定」
    await expect(toggleButton(page, 'order-entry-deposit-category', '特定')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('[CDT-21] 「＋ 新規注文」は部店と口座番号だけを引き継ぐ', async ({ page }) => {
    await openSummary(page)
    await page.getByTestId('customer-holdings-new-order').click()

    await expectOrderEntryCustomer(page)
    expect(queryOf(page)).toEqual(CUSTOMER_QUERY)
    await expect(page.getByTestId('order-entry-ticker')).toHaveValue('')
  })

  test('[CDT-22] タブの「注文入力」は顧客カードとタブを残したまま部店と口座番号を引き継ぐ', async ({
    page,
  }) => {
    await openSummary(page)
    await page.getByTestId('customer-detail-tab-order-entry').click()

    await expectOrderEntryCustomer(page)
    expect(queryOf(page)).toEqual(CUSTOMER_QUERY)
    await expect(page.getByRole('heading', { name: '顧客詳細', exact: true })).toBeVisible()

    // ほかのタブへ戻れる
    await page.getByTestId('customer-detail-tab-summary').click()
    await expect(page).toHaveURL(new RegExp(`${summaryPath(YAMADA.ID)}$`))
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)
  })

  test('[CDT-34] 発注権限が無いと預りの操作は「閲覧のみ」で新規注文も出ない（仮計算は出る）', async ({
    page,
  }) => {
    await mockApi(page, [{ path: '*/api/auth/me', body: noOperationOperator }])
    await openSummary(page)
    await expect(holdingRows(page)).toHaveCount(yamadaHoldings.length)

    await expect(page.getByTestId('customer-holdings-view-only')).toHaveCount(yamadaHoldings.length)
    await expect(page.getByTestId('customer-holdings-buy')).toHaveCount(0)
    await expect(page.getByTestId('customer-holdings-sell')).toHaveCount(0)
    await expect(page.getByTestId('customer-holdings-new-order')).toHaveCount(0)
    await expect(page.getByTestId('customer-holdings-calculation')).toHaveCount(
      yamadaHoldings.length,
    )
    await expect(page.getByTestId('customer-holdings-calculation-entry')).toBeVisible()
  })

  test('[CDT-37] 行の「仮計算」は銘柄・売り・預り区分を仮計算タブへ引き継ぐ', async ({ page }) => {
    await openSummary(page)
    await holdingRow(page, TSLA).getByTestId('customer-holdings-calculation').click()

    await expect(page).toHaveURL(new RegExp(`${calculationsPath(YAMADA.ID)}\\?`))
    // 仮計算は特定預り区分のまま渡す（新規注文の deposit と違い、向きを読み替えない）
    expect(queryOf(page)).toEqual({
      symbol: TSLA.ティッカー,
      side: 'sell',
      specific_deposit: TSLA.預り売買区分,
    })
    await expect(page.getByTestId('customer-calc-symbol')).toHaveValue(TSLA.ティッカー)
    await expect(toggleButton(page, 'customer-calc-side', '売り')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByTestId('customer-calc-deposit').locator('option:checked')).toHaveText(
      '一般',
    )
    await expect(page.getByTestId('customer-detail-tab-calculations')).toHaveAttribute(
      'class',
      /is-active/,
    )
  })

  test('[CDT-38] 見出しの「仮計算」は引き継ぎなしで買いの仮計算を開く', async ({ page }) => {
    await openSummary(page)
    await page.getByTestId('customer-holdings-calculation-entry').click()

    await expect(page).toHaveURL(new RegExp(`${calculationsPath(YAMADA.ID)}$`))
    await expect(page.getByTestId('customer-calc-symbol')).toHaveValue('')
    await expect(toggleButton(page, 'customer-calc-side', '買い')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByTestId('customer-calc-deposit').locator('option:checked')).toHaveText(
      '特定',
    )
  })
})

test.describe('顧客詳細 仮計算', () => {
  test('[CDT-36] タブ「仮計算」で入力フォームと結果のカードが出る', async ({ page }) => {
    await openSummary(page)
    await page.getByTestId('customer-detail-tab-calculations').click()

    await expect(page).toHaveURL(new RegExp(`${calculationsPath(YAMADA.ID)}$`))
    await expect(page.getByTestId('customer-detail-tab-calculations')).toHaveAttribute(
      'class',
      /is-active/,
    )
    await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
    await expect(page.getByTestId('customer-calc-form')).toBeVisible()
    await expect(page.getByRole('heading', { name: /^現地費用/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^手数料条件/ })).toBeVisible()
    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText('買付概算 ／ 未実行')
    await expect(page.getByTestId('customer-calc-total-label')).toHaveText('概算必要金額')
    await expect(page.getByTestId('customer-calc-total')).toHaveText('—')

    // 空のまま実行すると項目の直下に不備が出て、計算はしない
    await page.getByTestId('customer-calc-submit').click()
    await expect(page.getByTestId('customer-calc-symbol')).toHaveAccessibleDescription(
      new RegExp(CALC_MESSAGES.symbolRequired),
    )
    await expect(page.getByTestId('customer-calc-quantity')).toHaveAccessibleDescription(
      new RegExp(CALC_MESSAGES.quantity),
    )
    await expect(page.getByTestId('customer-calc-unit-price')).toHaveAccessibleDescription(
      new RegExp(CALC_MESSAGES.unitPrice),
    )
    await expect(page).toHaveURL(new RegExp(`${calculationsPath(YAMADA.ID)}$`))
    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText('買付概算 ／ 未実行')
    await expect(page.getByTestId('customer-calc-total')).toHaveText('—')

    await page.getByTestId('customer-calc-back').click()
    await expect(page).toHaveURL(new RegExp(`${summaryPath(YAMADA.ID)}$`))
  })

  test('[CDT-39] 預りの「仮計算」から実行すると売却概算の明細・受取金額・概算損益が出る', async ({
    page,
  }) => {
    await openSummary(page)
    await holdingRow(page, AAPL).getByTestId('customer-holdings-calculation').click()
    await expect(page.getByTestId('customer-calc-symbol')).toHaveValue(AAPL.ティッカー)

    await runCalculation(page, { quantity: CALC_QUANTITY, unitPrice: CALC_UNIT_PRICE })

    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText(
      `売却概算 ／ ${AAPL.ティッカー} ${CALC_QUANTITY}株`,
    )
    await expect(calcRowLabels(page)).toHaveText(Object.keys(AAPL_SELL_ROWS))
    for (const [index, value] of Object.values(AAPL_SELL_ROWS).entries()) {
      await expect(calcRowValues(page).nth(index)).toHaveText(value)
    }
    await expect(page.getByTestId('customer-calc-total-label')).toHaveText('概算受取金額')
    await expect(page.getByTestId('customer-calc-total')).toHaveText('343,115 円')
    const profitLoss = page.getByTestId('customer-calc-profit-loss-value')
    await expect(profitLoss).toHaveText('+43,115 円')
    await expect(page.getByTestId('customer-calc-error')).toHaveCount(0)
    await expect(page.getByTestId('customer-calc-warnings')).toHaveCount(0)

    // 益の色は CSS クラス名ではなく、色のトークン（tokens.css の --color-profit）と見えかたで比べる
    const [actual, expected] = await profitLoss.evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-profit)'
      document.body.append(probe)
      const tokenColor = getComputedStyle(probe).color
      probe.remove()
      return [getComputedStyle(el).color, tokenColor]
    })
    expect(actual).toBe(expected)
  })

  test('[CDT-40] 成長投資枠の買いは NISA の 2 行が加わり、概算損益は出ない', async ({ page }) => {
    await page.goto(calculationsPath(YAMADA.ID))
    await expect(page.getByTestId('customer-calc-form')).toBeVisible()

    await runCalculation(page, {
      symbol: NVDA.ティッカー,
      deposit: '成長投資枠',
      quantity: CALC_QUANTITY,
      unitPrice: CALC_UNIT_PRICE,
    })

    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText(
      `買付概算 ／ ${NVDA.ティッカー} ${CALC_QUANTITY}株`,
    )
    await expect(calcRowValues(page)).toHaveCount(9)
    await expect(page.getByTestId('customer-calc-row-nisaFxRate')).toHaveText('157.76 円/USD')
    await expect(page.getByTestId('customer-calc-row-nisaAmount')).toHaveText('363,636 円')
    await expect(page.getByTestId('customer-calc-total-label')).toHaveText('概算必要金額')
    await expect(page.getByTestId('customer-calc-total')).toHaveText('349,547 円')
    await expect(page.getByTestId('customer-calc-profit-loss')).toHaveCount(0)
  })

  test('[CDT-41] 銘柄マスタに無い銘柄は理由の帯を出し、金額は「—」のまま', async ({ page }) => {
    const MISSING_SYMBOL = 'ZZZZ'

    await page.goto(calculationsPath(YAMADA.ID))
    await runCalculation(page, {
      symbol: MISSING_SYMBOL,
      quantity: CALC_QUANTITY,
      unitPrice: CALC_UNIT_PRICE,
    })

    await expect(page.getByTestId('customer-calc-error')).toHaveText(
      calculationMessages.symbolNotFound(MISSING_SYMBOL),
    )
    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText(
      '買付概算 ／ 計算できませんでした',
    )
    await expect(page.getByTestId('customer-calc-total')).toHaveText('—')
  })

  test('[CDT-42] サーバの注意（warnings）は結果と一緒に注意の帯に出る', async ({ page }) => {
    const FEE_PATTERN = 'Z'
    expect(FEE_PATTERNS[FEE_PATTERN]).toBeUndefined()
    // 一般（非特定）の MSFT の預りは無い
    expect(MSFT.預り売買区分).not.toBe('0')

    await page.goto(calculationsPath(YAMADA.ID))
    await runCalculation(page, {
      symbol: MSFT.ティッカー,
      side: '売り',
      deposit: '一般',
      quantity: CALC_QUANTITY,
      unitPrice: CALC_UNIT_PRICE,
      feePattern: FEE_PATTERN,
    })

    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText(
      `売却概算 ／ ${MSFT.ティッカー} ${CALC_QUANTITY}株`,
    )
    await expect(page.getByTestId('customer-calc-warnings').getByRole('listitem')).toHaveText([
      calculationMessages.unknownPattern(FEE_PATTERN),
      calculationMessages.noHolding,
    ])
    await expect(page.getByTestId('customer-calc-error')).toHaveCount(0)
  })

  test('[CDT-43] 計算が失敗すると理由の帯を出し、入力は残る', async ({ page }) => {
    await mockApi(page, [
      { method: 'post', path: '*/api/calculations', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(calculationsPath(YAMADA.ID))
    await runCalculation(page, {
      symbol: AAPL.ティッカー,
      quantity: CALC_QUANTITY,
      unitPrice: CALC_UNIT_PRICE,
    })

    await expect(page.getByTestId('customer-calc-error')).toContainText(SERVER_ERROR)
    await expect(page.getByTestId('customer-calc-result-caption')).toHaveText(
      '買付概算 ／ 計算できませんでした',
    )
    await expect(page.getByTestId('customer-calc-total')).toHaveText('—')
    await expect(page.getByTestId('customer-calc-symbol')).toHaveValue(AAPL.ティッカー)
    await expect(page.getByTestId('customer-calc-quantity')).toHaveValue(String(CALC_QUANTITY))
  })

  test('[CDT-44] 計算の間は「計算中…」を出し、実行ボタンを押せない', async ({ page }) => {
    // ?mockDelay=<ミリ秒> を付けた URL だけ /api/* の応答が遅れる（src/mocks/handlers/index.js）
    await page.goto(`${calculationsPath(YAMADA.ID)}?mockDelay=1500`)
    await expect(page.getByTestId('customer-calc-form')).toBeVisible({ timeout: 10_000 })

    await runCalculation(page, {
      symbol: AAPL.ティッカー,
      quantity: CALC_QUANTITY,
      unitPrice: CALC_UNIT_PRICE,
    })

    const caption = page.getByTestId('customer-calc-result-caption')
    const submit = page.getByTestId('customer-calc-submit')
    await expect(caption).toHaveText('買付概算 ／ 計算中…')
    await expect(submit).toBeDisabled()
    await expect(caption).toHaveText(`買付概算 ／ ${AAPL.ティッカー} ${CALC_QUANTITY}株`, {
      timeout: 10_000,
    })
    await expect(submit).toBeEnabled()
  })
})

test.describe('顧客詳細 注文照会', () => {
  test('[CDT-24] その顧客の注文だけが件数とともに表示される', async ({ page }) => {
    await page.goto(ordersPath(YAMADA.ID))

    await expect(page.getByTestId('customer-orders-count')).toHaveText(`${yamadaOrders.length} 件`)
    await expectOrderRowIds(page, expectedRowIds(yamadaOrders))
  })

  test('[CDT-25] 部店・口座番号・顧客名の列は無い', async ({ page }) => {
    await page.goto(ordersPath(YAMADA.ID))

    await expect(page.getByTestId('customer-orders-table').getByRole('columnheader')).toHaveText(
      ORDER_COLUMNS,
    )
  })

  test('[CDT-26] 銘柄コードで絞り込むと URL と一覧に反映される', async ({ page }) => {
    const SYMBOL = 'AAPL'
    const matched = yamadaOrders.filter((row) => row.銘柄コード.includes(SYMBOL))
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.length).toBeLessThan(yamadaOrders.length)

    await page.goto(ordersPath(YAMADA.ID))
    await expect(orderRows(page)).toHaveCount(expectedRowIds(yamadaOrders).length)

    await page.getByTestId('customer-orders-symbol').fill(SYMBOL)
    await page.getByTestId('customer-orders-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`symbol=${SYMBOL}`))
    await expect(page.getByTestId('customer-orders-count')).toHaveText(`${matched.length} 件`)
    await expectOrderRowIds(page, expectedRowIds(matched))
  })

  test('[CDT-27] 出来状況で絞り込むと URL と一覧に反映される', async ({ page }) => {
    // 出来状況「注文中」の処理状況コード（コードマスタ 注文照会出来状況。src/mocks/fixtures/codes.js）
    const STATUS = '003'
    const matched = yamadaOrders.filter((row) => row.処理状況 === STATUS)
    expect(matched.length).toBeGreaterThan(0)

    await page.goto(ordersPath(YAMADA.ID))
    await expect(orderRows(page)).toHaveCount(expectedRowIds(yamadaOrders).length)

    await page.getByTestId('customer-orders-status').selectOption({ label: '注文中' })
    await page.getByTestId('customer-orders-search-submit').click()

    await expect(page).toHaveURL(new RegExp(`status=${STATUS}`))
    await expectOrderRowIds(page, expectedRowIds(matched))
  })

  test('[CDT-28] 絞り込み付きの URL を直接開くと検索欄と一覧に復元される', async ({ page }) => {
    const SYMBOL = 'MSFT'
    const matched = yamadaOrders.filter((row) => row.銘柄コード.includes(SYMBOL))
    expect(matched.length).toBeGreaterThan(0)

    await page.goto(`${ordersPath(YAMADA.ID)}?symbol=${SYMBOL}`)

    await expect(page.getByTestId('customer-orders-symbol')).toHaveValue(SYMBOL)
    await expectOrderRowIds(page, expectedRowIds(matched))
  })

  test('[CDT-29] 注文の無い顧客は「この顧客の注文はありません」', async ({ page }) => {
    await page.goto(ordersPath(NO_HOLDINGS.ID))

    await expect(page.getByTestId('customer-orders-empty')).toHaveText('この顧客の注文はありません')
    await expect(page.getByTestId('customer-orders-table')).toHaveCount(0)
  })

  test('[CDT-30] 当たらない条件では「条件に一致する注文が見つかりませんでした」', async ({
    page,
  }) => {
    // どの注文の銘柄コードにも含まれない文字列
    const NO_MATCH = 'ZZZZ'
    expect(orderInquiryRows.some((row) => row.銘柄コード.includes(NO_MATCH))).toBe(false)

    await page.goto(ordersPath(YAMADA.ID))
    await expect(orderRows(page)).toHaveCount(expectedRowIds(yamadaOrders).length)

    await page.getByTestId('customer-orders-symbol').fill(NO_MATCH)
    await page.getByTestId('customer-orders-search-submit').click()

    await expect(page.getByTestId('customer-orders-empty')).toHaveText(
      '条件に一致する注文が見つかりませんでした',
    )
    await expect(page.getByTestId('customer-orders-table')).toHaveCount(0)
    await expect(page.getByTestId('customer-orders-search')).toBeVisible()
  })

  test('[CDT-31] 注文の取得が失敗すると注文の欄にエラーを出し、顧客カードとタブは残る', async ({
    page,
  }) => {
    await mockApi(page, [{ path: '*/api/orders', status: 500, body: { detail: SERVER_ERROR } }])
    await page.goto(ordersPath(YAMADA.ID))

    const error = page.getByTestId('customer-orders-error')
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('customer-orders-table')).toHaveCount(0)
    await expect(page.getByTestId('customer-info-name')).toHaveText(YAMADA.顧客名)
    await expect(page.getByTestId('customer-detail-tabs')).toBeVisible()
  })

  test('[CDT-32] 注文を読む間は注文の欄に読み込み中を出す', async ({ page }) => {
    await page.goto(`${ordersPath(YAMADA.ID)}?mockDelay=1500`)

    await expect(page.getByTestId('customer-info-bar')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('customer-orders-loading')).toBeVisible()
    await expect(orderRows(page)).toHaveCount(expectedRowIds(yamadaOrders).length, {
      timeout: 10_000,
    })
    await expect(page.getByTestId('customer-orders-loading')).toHaveCount(0)
  })

  test('[CDT-33] ヘッダの「新規注文」は部店と口座番号を引き継ぐ', async ({ page }) => {
    await page.goto(ordersPath(YAMADA.ID))
    await expect(orderRows(page)).toHaveCount(expectedRowIds(yamadaOrders).length)

    await page.getByTestId('customer-orders-new-order').click()

    await expectOrderEntryCustomer(page)
    expect(queryOf(page)).toEqual(CUSTOMER_QUERY)
  })

  test('[CDT-35] 発注権限が無いと訂正・取消と新規注文が出ない', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/auth/me', body: noOperationOperator }])
    await page.goto(ordersPath(YAMADA.ID))

    const rowCount = expectedRowIds(yamadaOrders).length
    await expect(orderRows(page)).toHaveCount(rowCount)
    await expect(
      page.getByTestId('customer-orders-table').getByTestId('order-inquiry-view-only'),
    ).toHaveCount(rowCount)
    await expect(page.getByTestId('order-inquiry-amend')).toHaveCount(0)
    await expect(page.getByTestId('order-inquiry-cancel')).toHaveCount(0)
    await expect(page.getByTestId('customer-orders-new-order')).toHaveCount(0)
  })
})

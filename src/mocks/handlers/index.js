import { delay, http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'
import { canceledMarketHolidays, marketHolidays } from '../fixtures/marketHolidays'
import { blackoutDates, canceledBlackoutDates } from '../fixtures/blackoutDates'
import {
  CA_TYPE_NAMES,
  caStocks,
  canceledCorporateActions,
  corporateActions,
  formatRatio,
} from '../fixtures/ca'
import { canceledStocks, stocks } from '../fixtures/stocks'
import { hardLimitSetting } from '../fixtures/hardLimits'
import { codeMasters } from '../fixtures/codes'
import { canceledCustomers, customers } from '../fixtures/customers'

/*
 * モックハンドラの集約。
 *
 * ルール:
 *  - パスは `* + baseURL` で始める（`*` で origin の違いを吸収し、ブラウザ/Node 双方で一致させる）
 *  - バックエンドで実装された API は、このリストから削除する。
 *    未定義のリクエストは実 API へ素通しされるため、削除するだけで本物に切り替わる。
 *
 * 例外は海外休場日（/holidays）・受注不可日（/blackout-dates）・ハードリミット（/hard-limits）。
 * 実 API は実装済みだが、単体テストと E2E がこの handlers を共用しているのでハンドラは残し、
 * **実 API と同じ形**に寄せてある。
 *   /holidays / /blackout-dates … 日本語キー / integer の日付 / 降順 / エラーは { detail } / 論理削除
 *   /hard-limits                … 日本語キー / 拒否は 422 の HTTPValidationError と 409 の ErrorResponse
 * 実 API に当てて動かすときは .env の VITE_ENABLE_MSW=false にする。
 */

/*
 * 登録系のモックは「追加したものが一覧に出る」ところまで再現したいので、
 * フィクスチャの写しを書き換え可能な状態として持つ。
 * フィクスチャ自体（fixtures/marketHolidays.js）は生の形のまま触らない。
 * テスト間で持ち越さないよう、単体テストは vitest.setup.js の afterEach で resetMockState() を呼ぶ。
 */
// 海外休場日と受注不可日は論理削除なので、取消済みの行も持ったままにする（一覧では取消区分で外す）
let marketHolidayRows = [...marketHolidays, ...canceledMarketHolidays]
let blackoutDateRows = [...blackoutDates, ...canceledBlackoutDates]
// ハードリミットは 1 件しか無いので、行の配列ではなくオブジェクトの写しを持つ
let hardLimitRow = { ...hardLimitSetting }

/*
 * バックエンドが受け付ける海外休場区分コード。
 * src/utils/marketHolidayTypes.js と同じ値だが、モックは「バックエンド側の検証」を模すものなので
 * アプリ内のコードには依存させず、ここに独立して持つ。
 */
const HOLIDAY_TYPE_CODES = ['0', '1']

/** 休場区分名はサーバが付けて返す項目。フロントは使わないが、形をそろえるために持つ */
const HOLIDAY_TYPE_NAMES = { 0: '終日休場', 1: '短縮取引' }

/**
 * 受注不可日の一覧が 1 ページで返す件数。
 * 実 API 側はクエリで変えられない固定値なので、モックも定数で持つ
 * （海外休場日は limit を受け付けるので、そちらはクエリから読む）。
 */
const BLACKOUT_DATES_PER_PAGE = 50

/**
 * CAマスタの行。登録したものが一覧に出るところまで再現したいので書き換え可能に持つ。
 * 取消済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
let caRows = [...corporateActions, ...canceledCorporateActions]

/**
 * 銘柄マスタの行。いまは読むだけ（登録・更新・削除はまだ無い）なので、
 * 書き換え可能な状態にはせずフィクスチャをそのまま使う。
 */
const stockRows = [...stocks, ...canceledStocks]

/**
 * 銘柄マスタの一覧が 1 ページで返す件数。
 * 実 API は `limit` クエリを持たない固定値（受注不可日と同じ）なので、モックも定数で持つ。
 */
const STOCKS_PER_PAGE = 50

/**
 * 顧客マスタの行。CA と同じく読むだけなので、書き換え可能な状態にはしない
 * （そのため resetMockState() にも登録しない）。
 * 削除済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
const customerRows = [...customers, ...canceledCustomers]

/**
 * 顧客マスタの一覧が 1 ページで返す件数。
 * 実 API 側はクエリで変えられない固定値なので、モックも定数で持つ。
 */
const CUSTOMERS_PER_PAGE = 50

/**
 * CA の並び順。実 API（ca_repository.list）の
 * `ORDER BY COALESCE(効力発生日, 権利付最終日, 99999999) DESC, ID DESC` と同じ。
 * 日付は YYYYMMDD の integer なので、数値の大小がそのまま日付の大小になる。
 */
function caSortKey(ca) {
  return ca.効力発生日 ?? ca.権利付最終日 ?? 99999999
}

/**
 * ローディング表示を目で確かめるための遅延（ブラウザでの開発時だけのつまみ）。
 *
 * モックは即座に応答するので、そのままでは 4 状態のうちローディングだけが一瞬すぎて見えない。
 * URL に `?mockDelay=3000` を付けると、以降そのタブの API 応答が 3 秒遅れる。
 * sessionStorage に覚えるので画面を遷移しても効き続ける（`?mockDelay=0` で解除）。
 *
 * 単体テストと E2E は付けないので常に 0 になり、実行時間には影響しない。
 */
const MOCK_DELAY_KEY = 'mockDelay'

function mockDelayMs() {
  // 単体テストの jsdom にも window はあるが、クエリも sessionStorage も空なので 0 になる
  if (typeof window === 'undefined') return 0

  const fromQuery = new URLSearchParams(window.location.search).get(MOCK_DELAY_KEY)
  if (fromQuery !== null) window.sessionStorage.setItem(MOCK_DELAY_KEY, fromQuery)

  return Number(window.sessionStorage.getItem(MOCK_DELAY_KEY)) || 0
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetMockState() {
  marketHolidayRows = [...marketHolidays, ...canceledMarketHolidays]
  blackoutDateRows = [...blackoutDates, ...canceledBlackoutDates]
  caRows = [...corporateActions, ...canceledCorporateActions]
  hardLimitRow = { ...hardLimitSetting }
}

export const handlers = [
  /*
   * 遅延だけを担う先頭のハンドラ。応答を返さない（undefined）ので、
   * 待ったあとは次に一致するハンドラがそのまま応答する。
   */
  http.all('*/api/*', async () => {
    const ms = mockDelayMs()
    if (ms > 0) await delay(ms)
  }),

  http.get('*/api/orders', () => HttpResponse.json(orderListResponse)),

  /*
   * 全コードマスタ一括取得。各画面のプルダウンの選択肢はここから来る。
   * 実 API は絞り込みのクエリを持たず、常に全部返す。
   */
  http.get('*/api/codes', () => HttpResponse.json(codeMasters)),

  /*
   * 顧客マスタの一覧。削除済み（取消区分 1）は既定で返さない。
   * 実 API は 1 ページ 50 件で固定されていて limit というクエリを持たないので、
   * ここも limit を読まない。
   *
   * クエリ名は実 API に合わせて日本語。顧客名だけ 顧客名 / 顧客名カナ への部分一致で、
   * ほかは完全一致（実 API の m_口座情報 の検索と同じ）。
   *
   * 取引停止区分_全取引 / 口座区分 / 法人区分 は openapi に無いクエリで、画面モックにある
   * 検索条件をモックだけで成立させるためのもの。実 API に切り替えるときは仕様追加を依頼する。
   */
  http.get('*/api/customers', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = params.get('部店コード') ?? ''
    const handlerCode = params.get('扱者コード') ?? ''
    const accountNo = toNonNegativeInt(params.get('口座番号'), 0)
    const customerName = (params.get('顧客名') ?? '').trim()
    const restriction = params.get('取引停止区分_全取引') ?? ''
    const accountType = params.get('口座区分') ?? ''
    const corporateType = params.get('法人区分') ?? ''
    const includeDeleted = params.get('include_deleted') === 'true'
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = customerRows
      .filter(
        (customer) =>
          (includeDeleted || customer.取消区分 === 0) &&
          (!branchCode || customer.部店コード === branchCode) &&
          (!handlerCode || customer.扱者コード === handlerCode) &&
          (!accountNo || customer.口座番号 === accountNo) &&
          (!customerName ||
            customer.顧客名.includes(customerName) ||
            customer.顧客名カナ.includes(customerName)) &&
          // 取引停止区分だけ integer なので、文字列のクエリと比べる前に型をそろえる
          (!restriction || String(customer.取引停止区分_全取引) === restriction) &&
          (!accountType || customer.口座区分 === accountType) &&
          (!corporateType || customer.法人区分 === corporateType),
      )
      .sort((a, b) => a.口座番号 - b.口座番号)

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      customers: filtered.slice(offset, offset + CUSTOMERS_PER_PAGE),
    })
  }),

  /*
   * CAマスタ（コーポレートアクション）の一覧。取消済み（取消区分 1）は既定で返さない。
   * 銘柄コードの絞り込みは実 API と同じ**部分一致**で、銘柄コードか Ticker のどちらかに当たればよい
   * （実 API は `銘柄コード LIKE %s OR Ticker LIKE %s`）。
   * CSV 入出力と更新履歴（/ca/export-csv ほか）は画面が使わないのでモックしない。
   */
  http.get('*/api/ca', ({ request }) => {
    const params = new URL(request.url).searchParams
    // DB 照合は大文字小文字を区別しないので、モックも大文字に寄せてから比べる
    const stockCode = (params.get('stock_code') ?? '').trim().toUpperCase()
    const caType = params.get('ca_type') ?? ''
    const includeDeleted = params.get('include_deleted') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = caRows
      .filter(
        (ca) =>
          (includeDeleted || ca.取消区分 === 0) &&
          (!stockCode ||
            ca.銘柄コード.toUpperCase().includes(stockCode) ||
            // Ticker は nullable。銘柄マスタに無いコードで登録された行では欠ける
            (ca.Ticker ?? '').toUpperCase().includes(stockCode)) &&
          (!caType || ca.CA種別 === caType),
      )
      .sort((a, b) => caSortKey(b) - caSortKey(a) || b.ID - a.ID)

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      ca_list: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 銘柄マスタの一覧。取消済み（取消区分 1）は既定で返さない。
   *
   * 実 API のクエリ名は日本語で、`limit` を持たない（1 ページ 50 件固定。応答の limit は常に 50）。
   * 銘柄コードの絞り込みは実 API の `LIKE %s` に合わせた**部分一致**で、
   * 画面の検索欄 1 つで銘柄コードと Ticker のどちらにも当たるようにしてある。
   * **銘柄名では絞らない**（実 API は `銘柄名` / `銘柄名_英字` を別のパラメータに分けている）。
   * 区分 3 つは完全一致。
   *
   * CSV 入出力と更新履歴（/stocks/export-csv ほか）は画面が使わないのでモックしない。
   */
  http.get('*/api/stocks', ({ request }) => {
    const params = new URL(request.url).searchParams
    // DB 照合は大文字小文字を区別しないので、モックも大文字に寄せてから比べる
    const stockCode = (params.get('銘柄コード') ?? '').trim().toUpperCase()
    const regulation = params.get('規制情報') ?? ''
    const orderRoute = params.get('注文ルート') ?? ''
    const vwapTarget = params.get('VWAP対象区分') ?? ''
    const includeDeleted = params.get('include_deleted') === 'true'
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = stockRows
      .filter(
        (stock) =>
          (includeDeleted || stock.取消区分 === 0) &&
          (!stockCode ||
            stock.銘柄コード.toUpperCase().includes(stockCode) ||
            stock.Ticker.toUpperCase().includes(stockCode)) &&
          (!regulation || stock.規制情報 === regulation) &&
          (!orderRoute || stock.注文ルート === orderRoute) &&
          (!vwapTarget || stock.VWAP対象区分 === vwapTarget),
      )
      // 実 API の ORDER BY は仕様に書かれていないので、主キーの昇順を仮に置く
      .sort((a, b) => a.銘柄コード.localeCompare(b.銘柄コード))

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit: STOCKS_PER_PAGE,
      offset,
      stocks: filtered.slice(offset, offset + STOCKS_PER_PAGE),
    })
  }),

  /*
   * CA の入力内容の事前検証（登録・更新はしない）。
   *
   * **CA には一意性の規則が無い。** 自然キーを持たず、同じ銘柄・同じ CA種別・同じ日付の行が
   * 複数あっても正当（フィクスチャ自身が 1 銘柄に CA種別 110 を 3 件持つ）。
   * そのため受注不可日・海外休場日の「既に登録されています」にあたる検査は存在しない。
   * 代わりに実 API が見るのは**銘柄コードが銘柄マスタに実在するか**（と Ticker の補完）。
   *
   * `is_update` はクエリの `ca_id` が指す行の存在確認を足すだけ。受注不可日と違い
   * 本文の内容では切り替わらない（CA の同一性は本文ではなく ca_id にある）。
   */
  http.post('*/api/ca/validate', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = caRequestViolation(body)
    if (violation) return violation

    const params = new URL(request.url).searchParams
    const isUpdate = params.get('is_update') === 'true'
    const caId = Number(params.get('ca_id'))

    const ca = toCaInput(body)
    const errors = caServiceErrors(ca)
    if (isUpdate && !caRows.some((row) => row.ID === caId && row.取消区分 === 0)) {
      errors.push(`指定されたCA(ID=${caId})は存在しません`)
    }

    return HttpResponse.json({
      valid: errors.length === 0,
      errors,
      // CA に「登録できるが確認したいこと」は無い（再有効化が起きないため）。常に空
      warnings: [],
      details: errors.length === 0 ? toCaValidationDetails(ca) : null,
    })
  }),

  // CA の新規登録。必ず新しい行を INSERT する（再有効化という概念が無い）
  http.post('*/api/ca', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = caRequestViolation(body)
    if (violation) return violation

    const ca = toCaInput(body)
    const errors = caServiceErrors(ca)
    if (errors.length > 0) return detailError(400, errors[0])

    const created = toMockCaItem(ca)
    caRows = [...caRows, created]

    return HttpResponse.json(
      { success: true, ca: created, message: 'CAを登録しました' },
      { status: 201 },
    )
  }),

  /*
   * CA の更新（全項目を変更できる）。
   *
   * 検査の順序は「本文の形(422) → 対象が居るか(404) → 値の妥当性(400) → 盤面が古くないか(409)」。
   * 受注不可日の PUT にある「競合を重複より先に見る」という理由付けは、CA には重複検査が
   * 無いので当てはまらない（写さないこと）。
   */
  http.put('*/api/ca/:caId', async ({ params, request }) => {
    const body = await request.json().catch(() => null)
    const violation = caRequestViolation(body)
    if (violation) return violation

    const targetId = Number(params.caId)
    const current = caRows.find((ca) => ca.ID === targetId && ca.取消区分 === 0)
    if (!current) {
      return detailError(404, '指定されたCAデータが存在しません')
    }

    const ca = toCaInput(body)
    const errors = caServiceErrors(ca)
    if (errors.length > 0) return detailError(400, errors[0])

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    if (!isSameTimestamp(ca.updatedAt, current.更新日時)) {
      return detailError(
        409,
        '他のユーザーによってCAデータが更新されています。最新データを再取得してください。',
      )
    }

    const stock = findCaStock(ca.stockCode)
    const updated = {
      ...current,
      銘柄コード: stock?.stockCode ?? ca.stockCode,
      // 銘柄コードを変えたら Ticker も引き直す（実 API の自動補完と同じ）
      Ticker: stock?.ticker ?? null,
      CA種別: ca.caType,
      CA種別名: CA_TYPE_NAMES[ca.caType] ?? null,
      権利付最終日: ca.exRightsDate,
      効力発生日: ca.effectiveDate,
      支払日: ca.paymentDate,
      分母: ca.denominator,
      分子: ca.numerator,
      比率: formatRatio(ca.denominator, ca.numerator),
      備考: ca.note,
      ユーザー操作フラグ: 1,
      // 合札はサーバが新しくする（リクエストで来た値は照合に使うだけ）
      更新日時: nowIsoTimestamp(),
      更新者: '006',
    }
    caRows = caRows.map((row) => (row.ID === targetId ? updated : row))

    return HttpResponse.json({ success: true, ca: updated, message: 'CAを更新しました' })
  }),

  /*
   * CA の論理削除。行は残したまま 取消区分 を 1 にする。
   * 実 API は ユーザー操作フラグ も 1 に立てる（受注不可日のモックは削除時に触らないので、
   * ここは意図的に違う。include_deleted=true で見たときに差が出る）。
   */
  http.delete('*/api/ca/:caId', ({ params }) => {
    const targetId = Number(params.caId)
    const target = caRows.find((ca) => ca.ID === targetId && ca.取消区分 === 0)

    if (!target) {
      return detailError(404, '指定されたCAが存在しないか、既に削除されています')
    }

    const deleted = {
      ...target,
      取消区分: 1,
      ユーザー操作フラグ: 1,
      取消日時: nowIsoTimestamp(),
      取消者: '006',
    }
    caRows = caRows.map((ca) => (ca.ID === targetId ? deleted : ca))

    return HttpResponse.json({ success: true, ca: deleted, message: 'CAを削除しました' })
  }),

  // 海外休場日マスタの一覧。取消済み（取消区分 1）は既定で返さない
  http.get('*/api/holidays', ({ request }) => {
    const params = new URL(request.url).searchParams
    const startDate = toNonNegativeInt(params.get('start_date'), 0)
    const endDate = toNonNegativeInt(params.get('end_date'), 0)
    const holidayType = params.get('holiday_type') ?? ''
    const includeDeleted = params.get('include_deleted') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 休場日は YYYYMMDD の integer なので、数値の大小がそのまま日付の大小になる。
    // 並べ替えは実 API と同じく読み出し側で行う（登録・再有効化のたびに並びを気にしなくてよい）
    const filtered = marketHolidayRows
      .filter(
        (holiday) =>
          (includeDeleted || holiday.取消区分 === 0) &&
          (!startDate || holiday.休場日 >= startDate) &&
          (!endDate || holiday.休場日 <= endDate) &&
          (!holidayType || holiday.休場区分 === holidayType),
      )
      .sort((a, b) => b.休場日 - a.休場日)

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      holidays: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 登録前の事前検証。実 API と同じく、不合格も「200 + valid: false」で返す
   * （通信エラーと区別できるようにするため）。
   * 取消済みの日付は登録できるが、再有効化になることを warnings で伝える。
   */
  http.post('*/api/holidays/validate', async ({ request }) => {
    const { holidayDate, holidayType, reason } = await readHolidayRequest(request)

    const errors = []
    if (!isHolidayDate(holidayDate)) errors.push('休場日は YYYYMMDD 形式で入力してください')
    if (!HOLIDAY_TYPE_CODES.includes(holidayType)) errors.push('休場区分を選択してください')
    if (!reason) errors.push('休場理由を入力してください')

    const existing = marketHolidayRows.find((holiday) => holiday.休場日 === holidayDate)
    if (existing && existing.取消区分 === 0) {
      errors.push(`休場日 ${holidayDate} は既に登録されています`)
    }

    const warnings =
      existing && existing.取消区分 === 1
        ? ['この日付は以前登録され削除されています。再度有効にします']
        : []

    return HttpResponse.json({
      valid: errors.length === 0,
      errors,
      warnings,
      details:
        errors.length === 0 ? toValidationDetails({ holidayDate, holidayType, reason }) : null,
    })
  }),

  // 海外休場日の新規登録。取消済みの同じ日付があれば再有効化する
  http.post('*/api/holidays', async ({ request }) => {
    const { holidayDate, holidayType, reason } = await readHolidayRequest(request)

    if (!isHolidayDate(holidayDate)) {
      return detailError(400, '休場日は YYYYMMDD 形式で入力してください')
    }
    if (!HOLIDAY_TYPE_CODES.includes(holidayType)) {
      return detailError(400, '休場区分を選択してください')
    }
    if (!reason) {
      return detailError(400, '休場理由を入力してください')
    }

    const existing = marketHolidayRows.find((holiday) => holiday.休場日 === holidayDate)
    if (existing && existing.取消区分 === 0) {
      return detailError(400, `休場日 ${holidayDate} は既に登録されています`)
    }

    const created = toMockHolidayItem({ holidayDate, holidayType, reason })
    // 取消済みの行があれば置き換える（＝再有効化。行は増えない）
    marketHolidayRows = existing
      ? marketHolidayRows.map((holiday) => (holiday.休場日 === holidayDate ? created : holiday))
      : [...marketHolidayRows, created]

    return HttpResponse.json(
      { success: true, holiday: created, message: '海外休場日を登録しました' },
      { status: 201 },
    )
  }),

  // 海外休場日の論理削除。行は残したまま取消区分を 1 にする
  http.delete('*/api/holidays/:holidayDate', ({ params }) => {
    const holidayDate = Number(params.holidayDate)
    const target = marketHolidayRows.find(
      (holiday) => holiday.休場日 === holidayDate && holiday.取消区分 === 0,
    )

    if (!target) {
      return detailError(404, `指定された海外休場日が存在しません: ${params.holidayDate}`)
    }

    const deleted = { ...target, 取消区分: 1, 取消日時: '2026-09-10T10:00:00', 取消者: '702' }
    marketHolidayRows = marketHolidayRows.map((holiday) =>
      holiday.休場日 === holidayDate ? deleted : holiday,
    )

    return HttpResponse.json({
      success: true,
      holiday: deleted,
      message: '海外休場日を削除しました',
    })
  }),

  /*
   * 受注不可日マスタの一覧。取消済み（取消区分 1）は既定で返さない。
   * 実 API は 1 ページ 50 件で固定されていて limit というクエリを持たないので、
   * ここも limit を読まない（応答の limit は常に 50）。
   */
  http.get('*/api/blackout-dates', ({ request }) => {
    const params = new URL(request.url).searchParams
    const startDate = toNonNegativeInt(params.get('start_date'), 0)
    const endDate = toNonNegativeInt(params.get('end_date'), 0)
    const blackoutDate = toNonNegativeInt(params.get('blackout_date'), 0)
    const includeDeleted = params.get('include_deleted') === 'true'
    const offset = toNonNegativeInt(params.get('offset'), 0)

    // 受注不可日は YYYYMMDD の integer なので、数値の大小がそのまま日付の大小になる。
    // 並べ替えは実 API と同じく読み出し側で行う（登録・再有効化のたびに並びを気にしなくてよい）
    const filtered = blackoutDateRows
      .filter(
        (blackout) =>
          (includeDeleted || blackout.取消区分 === 0) &&
          (!startDate || blackout.受注不可日 >= startDate) &&
          (!endDate || blackout.受注不可日 <= endDate) &&
          (!blackoutDate || blackout.受注不可日 === blackoutDate),
      )
      .sort((a, b) => b.受注不可日 - a.受注不可日)

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit: BLACKOUT_DATES_PER_PAGE,
      offset,
      blackout_dates: filtered.slice(offset, offset + BLACKOUT_DATES_PER_PAGE),
    })
  }),

  /*
   * 登録・更新前の事前検証。実 API と同じく、不合格も「200 + valid: false」で返す
   * （通信エラーと区別できるようにするため）。warnings は実 API が常に空を返す
   * （取消済みの日付を登録し直しても警告は出ず、そのまま再有効化される）。
   *
   * is_update で見るものが変わる。新規検証は「その日付が空いているか」、
   * 変更検証は「その日付が実在し取消済みでないか」。実 API は最初に見つけた理由で
   * 打ち切るので、errors も 1 件までにそろえる。
   */
  http.post('*/api/blackout-dates/validate', async ({ request }) => {
    const { blackoutDate, reason } = await readBlackoutDateRequest(request)
    const violation = blackoutDateRequestViolation({ blackoutDate, reason })
    if (violation) return violation

    const isUpdate = new URL(request.url).searchParams.get('is_update') === 'true'
    const existing = blackoutDateRows.find((blackout) => blackout.受注不可日 === blackoutDate)

    let error = blackoutDateFormatError(blackoutDate)
    if (!error && isUpdate && (!existing || existing.取消区分 === 1)) {
      error = `指定された受注不可日(${blackoutDate})は存在しません`
    }
    if (!error && !isUpdate && existing && existing.取消区分 === 0) {
      error = `受注不可日(${blackoutDate})は既に登録されています`
    }

    return HttpResponse.json({
      valid: !error,
      errors: error ? [error] : [],
      warnings: [],
      details: error ? null : { 受注不可日: blackoutDate, 備考: reason },
    })
  }),

  // 受注不可日の新規登録。取消済みの同じ日付があれば再有効化する（行は増えない）
  http.post('*/api/blackout-dates', async ({ request }) => {
    const { blackoutDate, reason } = await readBlackoutDateRequest(request)
    const violation = blackoutDateRequestViolation({ blackoutDate, reason })
    if (violation) return violation

    const formatError = blackoutDateFormatError(blackoutDate)
    if (formatError) return detailError(400, formatError)

    const existing = blackoutDateRows.find((blackout) => blackout.受注不可日 === blackoutDate)
    if (existing && existing.取消区分 === 0) {
      return detailError(400, `受注不可日(${blackoutDate})は既に登録されています`)
    }

    const created = toMockBlackoutDateItem({
      blackoutDate,
      reason,
      reactivated: Boolean(existing),
    })
    // 取消済みの行があれば置き換える（＝再有効化。行は増えない）
    blackoutDateRows = existing
      ? blackoutDateRows.map((blackout) =>
          blackout.受注不可日 === blackoutDate ? created : blackout,
        )
      : [...blackoutDateRows, created]

    return HttpResponse.json(
      { success: true, blackout_date: created, message: '受注不可日を登録しました' },
      { status: 201 },
    )
  }),

  /*
   * 受注不可日の更新（日付と理由の両方を変更できる）。
   * パスが変更前の日付、本文の 受注不可日 が変更後の日付。
   *
   * 検査の順序が要点で、「対象が居るか → 入力の形 → 盤面が古くないか → 他の行との重複」と見る。
   * 競合（409）を重複より先に見るのは、他の利用者が書き換えた後の行に
   * 「その日付は既に登録されています」と返すと理由を取り違えさせるため。
   * まず「盤面が古い」ことを伝える。
   */
  http.put('*/api/blackout-dates/:blackoutDate', async ({ params, request }) => {
    const targetDate = Number(params.blackoutDate)
    const { blackoutDate, reason, updatedAt } = await readBlackoutDateRequest(request)
    const violation = blackoutDateRequestViolation({ blackoutDate, reason })
    if (violation) return violation

    const current = blackoutDateRows.find(
      (blackout) => blackout.受注不可日 === targetDate && blackout.取消区分 === 0,
    )
    if (!current) {
      return detailError(404, '指定された受注不可日データが存在しません')
    }

    const formatError = blackoutDateFormatError(blackoutDate)
    if (formatError) return detailError(400, formatError)

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    if (!isSameTimestamp(updatedAt, current.更新日時)) {
      return detailError(
        409,
        '他のユーザーによって受注不可日データが更新されています。最新データを再取得してください。',
      )
    }

    if (
      blackoutDate !== targetDate &&
      blackoutDateRows.some(
        (blackout) => blackout.受注不可日 === blackoutDate && blackout.取消区分 === 0,
      )
    ) {
      return detailError(400, `受注不可日(${blackoutDate})は既に登録されています`)
    }

    const updated = {
      ...current,
      受注不可日: blackoutDate,
      備考: reason,
      ユーザー操作フラグ: 1,
      // 合札はサーバが新しくする（リクエストで来た値は照合に使うだけ）
      更新日時: nowIsoTimestamp(),
      更新者: '006',
    }
    /*
     * 日付が主キーなので、日付を変えた更新は「元の日付の行を消して、新しい日付の行を置く」ことになる。
     * 一覧は読み出し側で並べ替えるので、ここでの位置は気にしない。
     */
    blackoutDateRows = [
      ...blackoutDateRows.filter((blackout) => blackout.受注不可日 !== targetDate),
      updated,
    ]

    return HttpResponse.json({
      success: true,
      blackout_date: updated,
      message: '受注不可日を更新しました',
    })
  }),

  // 受注不可日の論理削除。行は残したまま取消区分を 1 にする
  http.delete('*/api/blackout-dates/:blackoutDate', ({ params }) => {
    const targetDate = Number(params.blackoutDate)
    const target = blackoutDateRows.find(
      (blackout) => blackout.受注不可日 === targetDate && blackout.取消区分 === 0,
    )

    if (!target) {
      return detailError(404, '指定された受注不可日が存在しないか、既に削除されています')
    }

    const deleted = { ...target, 取消区分: 1, 取消日時: nowIsoTimestamp(), 取消者: '006' }
    blackoutDateRows = blackoutDateRows.map((blackout) =>
      blackout.受注不可日 === targetDate ? deleted : blackout,
    )

    return HttpResponse.json({
      success: true,
      blackout_date: deleted,
      message: '受注不可日を削除しました',
    })
  }),

  // ハードリミット（バックエンドの呼称は「スライス注文設定」）。1 件だけの設定なので一覧ではない
  http.get('*/api/hard-limits', () => HttpResponse.json(hardLimitRow)),

  /*
   * ハードリミットの更新。拒否の形は実 API（FastAPI）に合わせる。
   *
   *   422 HTTPValidationError … pydantic の制約違反。{ detail: [{ type, loc, msg, input, ctx }] }
   *   409 ErrorResponse       … 楽観的ロックの競合。{ detail: '…' }
   *
   * 409 は openapi.json に宣言が無い（PUT の description にだけ「楽観的ロック（更新日時照合・
   * 409 Conflict）に対応」と書かれた宣言漏れ）が、実 API では実装されている。
   * 画面側では検証しない方針なので、拒否の理由はここが持つ。
   */
  http.put('*/api/hard-limits', async ({ request }) => {
    const body = await request.json().catch(() => null)

    // pydantic は不合格の項目を全部まとめて返す（先勝ちで 1 件ではない）
    const errors = SLICE_FIELD_RULES.flatMap((rule) => validateSliceField(body, rule))
    if (errors.length > 0) {
      return HttpResponse.json({ detail: errors }, { status: 422 })
    }

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    const updatedAt = body?.['更新日時'] ?? null
    if (updatedAt && updatedAt !== hardLimitRow['更新日時']) {
      return detailError(409, SLICE_CONFLICT_DETAIL)
    }

    hardLimitRow = {
      ...hardLimitRow,
      市場関与率: body['市場関与率'],
      大口数量閾値: body['大口数量閾値'],
      大口金額閾値: body['大口金額閾値'],
      /*
       * 省略された項目はサーバ側の既定に落とす（実 API の実測どおり。有効フラグは 1、備考は NULL）。
       * ここを「現在値を保つ」に甘くすると、api 層の送り忘れがテストをすり抜ける。
       */
      スライス有効フラグ: body['スライス有効フラグ'] ?? 1,
      備考: body['備考'] ?? null,
      // 画面から更新したので 1 が立つ（システム連携ではない）
      ユーザー操作フラグ: 1,
      更新日時: nowTimestamp(),
      更新者: '006',
    }

    return HttpResponse.json(hardLimitRow)
  }),
]

/** サーバが決める更新日時。バックエンドが返すのと同じ 'YYYY-MM-DD HH:MM:SS' 形式 */
function nowTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * サーバが決める日時。実 API が datetime を返すときの形（'2026-09-11T10:00:00'）。
 * nowTimestamp と違って T 区切りなのは、FastAPI が datetime を ISO で直列化するため。
 */
function nowIsoTimestamp() {
  return new Date().toISOString().slice(0, 19)
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * 実 API の ErrorResponse（`{ detail: string }`）と同じ形で返す。
 * 実 API 側は共通のモデルなので、マスタごとに分けず 1 つで使う。
 */
function detailError(status, detail) {
  return HttpResponse.json({ detail }, { status })
}

/**
 * FastAPI の 422（HTTPValidationError）と同じ形で返す。
 * 本文のスキーマ（pydantic）で弾かれるものはサービス層の検証へ進まず、この形になる。
 */
function requestValidationError(loc, msg, type) {
  return HttpResponse.json({ detail: [{ loc, msg, type }] }, { status: 422 })
}

/** YYYYMMDD の integer が実在する日か（範囲は見ない） */
function isRealYmd(value) {
  const year = Math.floor(value / 10000)
  const month = Math.floor(value / 100) % 100
  const day = value % 100
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/* ここからハードリミット（/hard-limits）のモック用ヘルパ。実 API の 422 を模すためだけのもの */

/**
 * SliceSettingUpdateRequest の制約（openapi.json）。
 * 市場関与率 0.0001〜1.0 / 大口数量閾値 1 以上の整数 / 大口金額閾値 1 以上。
 */
const SLICE_FIELD_RULES = [
  { field: '市場関与率', integer: false, ge: 0.0001, le: 1 },
  { field: '大口数量閾値', integer: true, ge: 1 },
  { field: '大口金額閾値', integer: false, ge: 1 },
]

/** 楽観的ロックの競合。実 API が返すのと同じ文言 */
const SLICE_CONFLICT_DETAIL =
  '他のユーザーによってスライス設定が更新されました。最新情報を再取得してください。'

/**
 * pydantic の msg。実 API はおおむね日本語化しているが、整数チェックだけ素の英語で返る
 * （実測。'大口数量閾値' に 1.5 を送ったときの応答）。
 */
const SLICE_MESSAGES = {
  parsing: '数値で入力してください',
  int_from_float: 'Input should be a valid integer, got a number with a fractional part',
  greater_than_equal: '指定できる下限を下回っています',
  less_than_equal: '指定できる上限を超えています',
}

/**
 * 1 項目ぶんの検証。pydantic と同じく「型で落ちたら制約は見ない」順序にする。
 * 合格なら空配列（呼び出し側が flatMap でつなぐ）。
 */
function validateSliceField(body, { field, integer, ge, le }) {
  const input = body?.[field]

  if (typeof input !== 'number' || !Number.isFinite(input)) {
    // 数値に読めない。整数の項目は int_parsing、実数の項目は float_parsing になる
    const type = integer ? 'int_parsing' : 'float_parsing'
    return [sliceValidationError(type, field, SLICE_MESSAGES.parsing, input)]
  }
  if (integer && !Number.isInteger(input)) {
    return [sliceValidationError('int_from_float', field, SLICE_MESSAGES.int_from_float, input)]
  }
  if (ge !== undefined && input < ge) {
    const msg = SLICE_MESSAGES.greater_than_equal
    return [sliceValidationError('greater_than_equal', field, msg, input, { ge })]
  }
  if (le !== undefined && input > le) {
    const msg = SLICE_MESSAGES.less_than_equal
    return [sliceValidationError('less_than_equal', field, msg, input, { le })]
  }
  return []
}

/** ValidationError 1 件。loc の先頭は値の出所（本文なので 'body'）。ctx は制約違反のときだけ付く */
function sliceValidationError(type, field, msg, input, ctx) {
  return { type, loc: ['body', field], msg, input, ...(ctx ? { ctx } : {}) }
}

/* ここから海外休場日（/holidays）のモック用ヘルパ。実 API の形に合わせるためだけのもの */

/** HolidayRequest（日本語キー）を読み取る。型が違うものは「未入力」に寄せる */
async function readHolidayRequest(request) {
  const body = await request.json().catch(() => null)

  return {
    holidayDate: typeof body?.休場日 === 'number' ? body.休場日 : 0,
    holidayType: typeof body?.休場区分 === 'string' ? body.休場区分 : '',
    reason: typeof body?.休場理由 === 'string' ? body.休場理由.trim() : '',
  }
}

/** YYYYMMDD として妥当か（実在日かどうかまで見る） */
function isHolidayDate(value) {
  if (!Number.isInteger(value) || value < 19000101 || value > 29991231) return false

  return isRealYmd(value)
}

/** HolidayItem を組み立てる（登録・再有効化の応答用） */
function toMockHolidayItem({ holidayDate, holidayType, reason }) {
  return {
    休場日: holidayDate,
    休場区分: holidayType,
    休場区分名: HOLIDAY_TYPE_NAMES[holidayType] ?? null,
    休場理由: reason,
    取消区分: 0,
    // 画面からの登録なので 1（システム連携ではない）
    ユーザー操作フラグ: 1,
    作成日時: '2026-09-10T10:00:00',
    作成者: '702',
    更新日時: '2026-09-10T10:00:00',
    更新者: '702',
    取消日時: null,
    取消者: null,
  }
}

/** HolidayValidationDetails（事前検証が返す入力の解析結果） */
function toValidationDetails({ holidayDate, holidayType, reason }) {
  return {
    休場日: holidayDate,
    休場区分: holidayType,
    休場区分名: HOLIDAY_TYPE_NAMES[holidayType] ?? null,
    休場理由: reason,
  }
}

/* ここから受注不可日（/blackout-dates）のモック用ヘルパ。実 API の形に合わせるためだけのもの */

/**
 * BlackoutDateRequest（日本語キー）を読み取る。
 *
 * 備考は trim しない（実 API 側も trim せずそのまま保存する）。
 * 更新日時は「キーが無い」と「空文字」を区別する。前者は楽観的ロックの合札を送っていない
 * ことを意味し、照合を行わない（登録直後の行は実 API 側の更新日時が未設定）。
 */
async function readBlackoutDateRequest(request) {
  const body = await request.json().catch(() => null)

  return {
    blackoutDate: typeof body?.受注不可日 === 'number' ? body.受注不可日 : null,
    reason: typeof body?.備考 === 'string' ? body.備考 : '',
    updatedAt: typeof body?.更新日時 === 'string' ? body.更新日時 : null,
  }
}

/**
 * pydantic（BlackoutDateRequest）が本文を受け取る前に弾くもの。
 * 実 API はここで FastAPI の 422 を返し、サービス層の検証には進まない。
 * 画面はこの経路に入らない入力しか送らないが、モックが「サーバ側の検証」を模す以上
 * 素通しさせない（形の違う本文が 200 で通ると、api 層の取り違えに気づけない）。
 *
 * @returns {Response|null} 違反が無ければ null
 */
function blackoutDateRequestViolation({ blackoutDate, reason }) {
  if (!Number.isInteger(blackoutDate)) {
    return requestValidationError(['body', '受注不可日'], 'Field required', 'missing')
  }
  if (blackoutDate < 19000101) {
    return requestValidationError(
      ['body', '受注不可日'],
      'Input should be greater than or equal to 19000101',
      'greater_than_equal',
    )
  }
  if (blackoutDate > 29991231) {
    return requestValidationError(
      ['body', '受注不可日'],
      'Input should be less than or equal to 29991231',
      'less_than_equal',
    )
  }
  if (reason.length > 45) {
    return requestValidationError(
      ['body', '備考'],
      'String should have at most 45 characters',
      'string_too_long',
    )
  }
  return null
}

/**
 * サービス層（_validate_blackout_date）が見る日付の妥当性。
 * 8 桁と範囲は pydantic 側で弾かれるので、ここに来るのは 20260230 のような実在しない日だけ。
 *
 * @returns {string|null} 問題が無ければ null
 */
function blackoutDateFormatError(blackoutDate) {
  return isRealYmd(blackoutDate) ? null : '受注不可日に有効な日付（YYYYMMDD）を指定してください'
}

/**
 * 楽観的ロックの合札を照合する。
 *
 * 実 API は T と半角空白の差を吸収し、どちらかがもう一方の先頭に一致すれば同じ値と見なす
 * （秒未満の桁が付くかどうかがクライアントによって違うため）。
 * 合札を送っていない（null）ときと、サーバ側に更新日時が無いときは照合しない。
 */
function isSameTimestamp(provided, current) {
  if (provided === null || current === null || current === undefined) return true

  const normalizedProvided = String(provided).replace('T', ' ')
  const normalizedCurrent = String(current).replace('T', ' ')

  return (
    normalizedProvided.startsWith(normalizedCurrent) ||
    normalizedCurrent.startsWith(normalizedProvided)
  )
}

/** BlackoutDateItem を組み立てる（登録・再有効化の応答用） */
function toMockBlackoutDateItem({ blackoutDate, reason, reactivated = false }) {
  return {
    受注不可日: blackoutDate,
    備考: reason,
    取消区分: 0,
    // 画面からの登録なので 1（システム連携ではない）
    ユーザー操作フラグ: 1,
    作成日時: nowIsoTimestamp(),
    作成者: '006',
    /*
     * 新規登録では実 API 側も更新日時を入れない（INSERT の対象外）。
     * 取消済みの行の再有効化は UPDATE なので、そのときだけ入る。
     */
    更新日時: reactivated ? nowIsoTimestamp() : null,
    更新者: reactivated ? '006' : null,
    取消日時: null,
    取消者: null,
  }
}

/* ここから CAマスタ（/ca）のモック用ヘルパ。実 API の形に合わせるためだけのもの */

/**
 * pydantic（CARequest）が本文を受け取る前に弾くもの。
 * 実 API はここで FastAPI の 422 を返し、サービス層の検証には進まない。
 *
 * 見るのは **CARequest が宣言している制約だけ**。日付と 分母 / 分子 には範囲の制約が
 * 無いので（integer / number であることしか宣言されていない）、値の妥当性は
 * caServiceErrors 側に置く。
 *
 * @returns {Response|null} 違反が無ければ null
 */
function caRequestViolation(body) {
  const stockCode = body?.銘柄コード
  if (typeof stockCode !== 'string') {
    return requestValidationError(['body', '銘柄コード'], 'Field required', 'missing')
  }
  if (stockCode.length < 1) {
    return requestValidationError(
      ['body', '銘柄コード'],
      'String should have at least 1 character',
      'string_too_short',
    )
  }
  if (stockCode.length > 14) {
    return requestValidationError(
      ['body', '銘柄コード'],
      'String should have at most 14 characters',
      'string_too_long',
    )
  }

  const caType = body?.CA種別
  if (typeof caType !== 'string') {
    return requestValidationError(['body', 'CA種別'], 'Field required', 'missing')
  }
  // CA種別 は CATypeEnum。未知のコードは enum で弾かれ、サービス層には届かない
  if (!Object.hasOwn(CA_TYPE_NAMES, caType)) {
    return requestValidationError(
      ['body', 'CA種別'],
      `Input should be ${Object.keys(CA_TYPE_NAMES).join(', ')}`,
      'enum',
    )
  }

  for (const field of ['権利付最終日', '効力発生日', '支払日']) {
    const value = body?.[field]
    if (value !== null && value !== undefined && !Number.isInteger(value)) {
      return requestValidationError(
        ['body', field],
        'Input should be a valid integer',
        'int_parsing',
      )
    }
  }

  for (const field of ['分母', '分子']) {
    const value = body?.[field]
    if (value !== null && value !== undefined && !Number.isFinite(value)) {
      return requestValidationError(['body', field], 'Input should be a valid number', 'float_type')
    }
  }

  const note = body?.備考
  if (typeof note === 'string' && note.length > 200) {
    return requestValidationError(
      ['body', '備考'],
      'String should have at most 200 characters',
      'string_too_long',
    )
  }

  return null
}

/**
 * CARequest（日本語キー）を、このモックが扱いやすい形に読み替える。
 * caRequestViolation を通した本文にだけ使う（型はそこで保証されている）。
 */
function toCaInput(body) {
  return {
    stockCode: body.銘柄コード,
    caType: body.CA種別,
    exRightsDate: body.権利付最終日 ?? null,
    effectiveDate: body.効力発生日 ?? null,
    paymentDate: body.支払日 ?? null,
    denominator: body.分母 ?? null,
    numerator: body.分子 ?? null,
    // 備考は nullable。空文字に寄せず、送られてきた形のまま保存する
    note: typeof body.備考 === 'string' ? body.備考 : null,
    updatedAt: typeof body.更新日時 === 'string' ? body.更新日時 : null,
  }
}

/**
 * サービス層（_validate_ca）が見る妥当性。
 *
 * 実 API の事前検証は「銘柄コードマスタ存在検証 & Ticker自動補完 / CA種別必須検証 /
 * 日付妥当性検証 / 比率の数値検証」を行う。CA種別の必須は pydantic 側で弾かれるので、
 * ここに残るのは銘柄の実在・日付の実在・比率の符号。
 *
 * pydantic と違い**まとめて全件返す**（事前検証の応答は errors の配列なので、
 * 直せるところを一度に見せられる）。
 *
 * @returns {string[]} 問題が無ければ空配列
 */
function caServiceErrors({
  stockCode,
  exRightsDate,
  effectiveDate,
  paymentDate,
  denominator,
  numerator,
}) {
  const errors = []

  if (!findCaStock(stockCode)) {
    errors.push(`銘柄コード(${stockCode})は銘柄マスタに存在しません`)
  }

  const dates = [
    ['権利付最終日', exRightsDate],
    ['効力発生日', effectiveDate],
    ['支払日', paymentDate],
  ]
  for (const [label, value] of dates) {
    if (value !== null && !isCaDate(value)) {
      errors.push(`${label}に有効な日付（YYYYMMDD）を指定してください`)
    }
  }

  for (const [label, value] of [
    ['分母', denominator],
    ['分子', numerator],
  ]) {
    if (value !== null && value <= 0) {
      errors.push(`${label}には正の数値を指定してください`)
    }
  }

  return errors
}

/**
 * YYYYMMDD として妥当か（実在日かどうかまで見る）。
 * CARequest の日付には範囲の制約が無いので、8 桁であることもここで見る
 * （受注不可日は pydantic 側に ge / le があるため、この関門が要らない）。
 */
function isCaDate(value) {
  if (!Number.isInteger(value) || value < 19000101 || value > 29991231) return false

  return isRealYmd(value)
}

/**
 * 銘柄マスタ（m_銘柄情報）の代役を引く。
 * DB 照合は大文字小文字を区別しないので、モックも寄せてから比べる。
 */
function findCaStock(stockCode) {
  const needle = String(stockCode ?? '').toUpperCase()

  return caStocks.find((stock) => stock.stockCode.toUpperCase() === needle) ?? null
}

/** ID の採番。実 API の AUTO_INCREMENT と同じく単調増加（取消済みの行も母数に入れる） */
function nextCaId() {
  return Math.max(0, ...caRows.map((ca) => ca.ID)) + 1
}

/** CAItem を組み立てる（登録の応答用） */
function toMockCaItem(ca) {
  const stock = findCaStock(ca.stockCode)

  return {
    ID: nextCaId(),
    // 銘柄マスタに在るコードなので、正規化された側（マスタの表記）で保存する
    銘柄コード: stock?.stockCode ?? ca.stockCode,
    // Ticker は送られてこない。実 API と同じく銘柄マスタから補完する
    Ticker: stock?.ticker ?? null,
    CA種別: ca.caType,
    // CA種別名 と 比率 は DB の列ではなく、応答を組み立てるときに付ける表示項目
    CA種別名: CA_TYPE_NAMES[ca.caType] ?? null,
    権利付最終日: ca.exRightsDate,
    効力発生日: ca.effectiveDate,
    支払日: ca.paymentDate,
    分母: ca.denominator,
    分子: ca.numerator,
    比率: formatRatio(ca.denominator, ca.numerator),
    備考: ca.note,
    取消区分: 0,
    // 画面からの登録なので 1（システム連携ではない）
    ユーザー操作フラグ: 1,
    作成日時: nowIsoTimestamp(),
    作成者: '006',
    // 新規登録では実 API 側も更新日時を入れない（INSERT の対象外）
    更新日時: null,
    更新者: null,
    取消日時: null,
    取消者: null,
  }
}

/**
 * CAValidationResponse の details（事前検証が返す入力の解析結果）。
 * openapi.json では `additionalProperties: true` で中身が未定義なので、
 * 「解析した入力 + サーバが補完・算出した項目」を返すという推測で置いている。
 * **フロントはこの値を読まない**（読み始めるならバックエンドに形を確認すること）。
 */
function toCaValidationDetails(ca) {
  const stock = findCaStock(ca.stockCode)

  return {
    銘柄コード: stock?.stockCode ?? ca.stockCode,
    Ticker: stock?.ticker ?? null,
    CA種別: ca.caType,
    CA種別名: CA_TYPE_NAMES[ca.caType] ?? null,
    権利付最終日: ca.exRightsDate,
    効力発生日: ca.effectiveDate,
    支払日: ca.paymentDate,
    比率: formatRatio(ca.denominator, ca.numerator),
  }
}

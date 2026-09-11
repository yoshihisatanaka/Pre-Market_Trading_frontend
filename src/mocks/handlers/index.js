import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'
import { canceledMarketHolidays, marketHolidays } from '../fixtures/marketHolidays'
import { blackoutDates, canceledBlackoutDates } from '../fixtures/blackoutDates'
import { hardLimitSetting } from '../fixtures/hardLimits'

/*
 * モックハンドラの集約。
 *
 * ルール:
 *  - パスは `* + baseURL` で始める（`*` で origin の違いを吸収し、ブラウザ/Node 双方で一致させる）
 *  - バックエンドで実装された API は、このリストから削除する。
 *    未定義のリクエストは実 API へ素通しされるため、削除するだけで本物に切り替わる。
 *
 * 例外は海外休場日（/holidays）と受注不可日（/blackout-dates）。実 API は実装済みだが、
 * 単体テストと E2E がこの handlers を共用しているのでハンドラは残し、**実 API と同じ形**
 * （日本語キー / integer の日付 / 降順 / エラーは { detail } / 論理削除）に寄せてある。
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

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetMockState() {
  marketHolidayRows = [...marketHolidays, ...canceledMarketHolidays]
  blackoutDateRows = [...blackoutDates, ...canceledBlackoutDates]
  hardLimitRow = { ...hardLimitSetting }
}

export const handlers = [
  http.get('*/api/orders', () => HttpResponse.json(orderListResponse)),

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
      ? blackoutDateRows.map((blackout) => (blackout.受注不可日 === blackoutDate ? created : blackout))
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
  http.get('*/api/slice-settings', () => HttpResponse.json(hardLimitRow)),

  /*
   * ハードリミットの更新。検証は openapi.json の SliceSettingUpdateRequest の制約に合わせる
   * （市場関与率 0.0001〜1.0 / 大口数量閾値 1 以上の整数 / 大口金額閾値 1 以上）。
   * 画面側では検証しない方針なので、拒否の理由はここが持つ。
   */
  http.put('*/api/slice-settings', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const rate = toFiniteNumber(body?.['市場関与率'])
    const quantity = toFiniteNumber(body?.['大口数量閾値'])
    const amount = toFiniteNumber(body?.['大口金額閾値'])

    if (rate === null || rate < 0.0001 || rate > 1) {
      return HttpResponse.json(
        {
          message: '市場関与率は 0.01%〜100% の範囲で入力してください。',
          code: 'invalid_participation_rate',
        },
        { status: 400 },
      )
    }
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1) {
      return HttpResponse.json(
        {
          message: '注文数量の上限は 1 株以上の整数で入力してください。',
          code: 'invalid_quantity',
        },
        { status: 400 },
      )
    }
    if (amount === null || amount < 1) {
      return HttpResponse.json(
        { message: '注文金額の上限は 1 USD 以上で入力してください。', code: 'invalid_amount' },
        { status: 400 },
      )
    }

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    const updatedAt = body?.['更新日時'] ?? null
    if (updatedAt && updatedAt !== hardLimitRow['更新日時']) {
      return HttpResponse.json(
        {
          message: '他の担当者が先に更新しました。再読み込みしてからやり直してください。',
          code: 'conflict',
        },
        { status: 409 },
      )
    }

    hardLimitRow = {
      ...hardLimitRow,
      市場関与率: rate,
      大口数量閾値: quantity,
      大口金額閾値: amount,
      // 省略されたら現在値を保つ（勝手に有効化しない）
      スライス有効フラグ: body?.['スライス有効フラグ'] ?? hardLimitRow['スライス有効フラグ'],
      更新日時: nowTimestamp(),
      更新者: '006',
    }

    return HttpResponse.json(hardLimitRow)
  }),
]

function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

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

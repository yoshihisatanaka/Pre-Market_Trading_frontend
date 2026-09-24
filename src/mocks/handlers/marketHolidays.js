import { http, HttpResponse } from 'msw'
import { canceledMarketHolidays, marketHolidays } from '../fixtures/marketHolidays'
import { detailError, isRealYmd, toNonNegativeInt } from './_shared'

/*
 * 登録系のモックは「追加したものが一覧に出る」ところまで再現したいので、
 * フィクスチャの写しを書き換え可能な状態として持つ。
 * フィクスチャ自体（fixtures/marketHolidays.js）は生の形のまま触らない。
 * 論理削除なので、取消済みの行も持ったままにする（一覧では取消区分で外す）。
 */
let marketHolidayRows = [...marketHolidays, ...canceledMarketHolidays]

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetMarketHolidayRows() {
  marketHolidayRows = [...marketHolidays, ...canceledMarketHolidays]
}

/*
 * バックエンドが受け付ける海外休場区分コード。
 * src/utils/marketHolidayTypes.js と同じ値だが、モックは「バックエンド側の検証」を模すものなので
 * アプリ内のコードには依存させず、ここに独立して持つ。
 */
const HOLIDAY_TYPE_CODES = ['0', '1']

/** 休場区分名はサーバが付けて返す項目。フロントは使わないが、形をそろえるために持つ */
const HOLIDAY_TYPE_NAMES = { 0: '終日休場', 1: '短縮取引' }

export const marketHolidayHandlers = [
  // 海外休場日マスタの一覧。取消済み（取消区分 1）は既定で返さない
  http.get('*/api/masters/market-holidays', ({ request }) => {
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
   * 登録・変更前の事前検証。実 API と同じく、不合格も「200 + valid: false」で返す
   * （通信エラーと区別できるようにするため）。
   * 取消済みの日付は登録できるが、再有効化になることを warnings で伝える。
   *
   * is_update で見るものが変わる。新規検証は「その日付が空いているか」、
   * 変更検証は「対象の行が実在し取消済みでないか」。**対象は本文の休場日ではなく
   * クエリの holiday_id で指す**ので、重複検査の根拠は主キーではなく休場日の一意制約になる
   * （受注不可日の blackout_date_id と同じ形）。
   * MarketHolidayUpdateRequest は 休場日 を持たないため、変更検証で日付は動かない。
   * 再有効化の警告は新規検証のときだけ出す。
   */
  http.post('*/api/masters/market-holidays/validate', async ({ request }) => {
    const { holidayDate, holidayType, reason } = await readHolidayRequest(request)

    const query = new URL(request.url).searchParams
    const isUpdate = query.get('is_update') === 'true'
    const currentId = query.has('holiday_id') ? Number(query.get('holiday_id')) : null

    const errors = []
    if (!isHolidayDate(holidayDate)) errors.push('休場日は YYYYMMDD 形式で入力してください')
    if (!HOLIDAY_TYPE_CODES.includes(holidayType)) errors.push('休場区分を選択してください')
    if (!reason) errors.push('休場理由を入力してください')

    if (isUpdate) {
      const target = marketHolidayRows.find((holiday) => holiday.ID === currentId)
      if (!target || target.取消区分 === 1) {
        errors.push(`指定された海外休場日(ID=${currentId})は存在しません`)
      }
    }

    // 同じ日付の行。変更検証では自分自身を重複に数えない
    const existing = marketHolidayRows.find((holiday) => holiday.休場日 === holidayDate)
    if (existing && existing.取消区分 === 0 && existing.ID !== currentId) {
      errors.push(`休場日 ${holidayDate} は既に登録されています`)
    }

    const warnings =
      !isUpdate && existing && existing.取消区分 === 1
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
  http.post('*/api/masters/market-holidays', async ({ request }) => {
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

    /*
     * 取消済みの行があれば置き換える（＝再有効化。行は増えない）。
     * 主キーは ID になったが、**再有効化では元の行の ID を引き継ぐ**（同じ行が生き返る）。
     * 重複の判断は主キーではなく休場日の一意制約で行う（src/mocks/handlers の銘柄と同じ整理）。
     */
    const created = toMockHolidayItem({
      id: existing ? existing.ID : nextMarketHolidayId(),
      holidayDate,
      holidayType,
      reason,
    })
    marketHolidayRows = existing
      ? marketHolidayRows.map((holiday) => (holiday.ID === existing.ID ? created : holiday))
      : [...marketHolidayRows, created]

    return HttpResponse.json(
      { success: true, holiday: created, message: '海外休場日を登録しました' },
      { status: 201 },
    )
  }),

  /*
   * 海外休場日の論理削除。行は残したまま取消区分を 1 にする。
   *
   * パスキーは ID。仕様の `/masters/market-holidays/{holiday_id}`（integer の行ID）と一致する
   * （2026-09-18 の取り込みで確定。それまではフロントが先回りして置いていた）。
   */
  http.delete('*/api/masters/market-holidays/:id', ({ params }) => {
    const targetId = Number(params.id)
    const target = marketHolidayRows.find(
      (holiday) => holiday.ID === targetId && holiday.取消区分 === 0,
    )

    if (!target) {
      return detailError(404, `指定された海外休場日が存在しません: ${params.id}`)
    }

    const deleted = { ...target, 取消区分: 1, 取消日時: '2026-09-10T10:00:00', 取消者: '702' }
    marketHolidayRows = marketHolidayRows.map((holiday) =>
      holiday.ID === targetId ? deleted : holiday,
    )

    return HttpResponse.json({
      success: true,
      holiday: deleted,
      message: '海外休場日を削除しました',
    })
  }),
]

/* ここから海外休場日（/masters/market-holidays）のモック用ヘルパ。実 API の形に合わせるためだけのもの */

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

/** ID の採番。実 API の AUTO_INCREMENT と同じく単調増加（取消済みの行も母数に入れる） */
function nextMarketHolidayId() {
  return Math.max(0, ...marketHolidayRows.map((holiday) => holiday.ID)) + 1
}

/**
 * HolidayItem を組み立てる（登録・再有効化の応答用）。
 *
 * **再有効化では取消済みの行の ID をそのまま渡す**（行も id も増やさない）。
 * 実 API がどちらの仕様になるかは未確定で、新しい id を採番する仕様ならここを直す
 * （→ docs/api/requests.md の依頼 #10。主キーの id 化とは別に残っている問い）。
 */
function toMockHolidayItem({ id, holidayDate, holidayType, reason }) {
  return {
    ID: id,
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

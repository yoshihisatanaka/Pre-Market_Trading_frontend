import { http, HttpResponse } from 'msw'
import { blackoutDates, canceledBlackoutDates } from '../fixtures/blackoutDates'
import {
  detailError,
  isRealYmd,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

// 論理削除なので、取消済みの行も持ったままにする（一覧では取消区分で外す）
let blackoutDateRows = [...blackoutDates, ...canceledBlackoutDates]

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetBlackoutDateRows() {
  blackoutDateRows = [...blackoutDates, ...canceledBlackoutDates]
}

/**
 * 受注不可日の一覧が 1 ページで返す件数。
 * 実 API 側はクエリで変えられない固定値なので、モックも定数で持つ
 * （海外休場日は limit を受け付けるので、そちらはクエリから読む）。
 */
const BLACKOUT_DATES_PER_PAGE = 50

export const blackoutDateHandlers = [
  /*
   * 受注不可日マスタの一覧。取消済み（取消区分 1）は既定で返さない。
   * 実 API は 1 ページ 50 件で固定されていて limit というクエリを持たないので、
   * ここも limit を読まない（応答の limit は常に 50）。
   */
  http.get('*/api/masters/blackout-dates', ({ request }) => {
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
   * 変更検証は「対象の行が実在し取消済みでないか」。実 API は最初に見つけた理由で
   * 打ち切るので、errors も 1 件までにそろえる。
   *
   * **対象は本文の日付ではなくクエリの blackout_date_id で指す**（CA の ca_id と同じ形）。
   * 主キーが ID になり、日付を変える編集でも対象を見失わなくなった。
   * これにより重複検査の根拠は主キーではなく **日付の一意制約**になる。
   * クエリ名は openapi.json にまだ無く、ca_id に倣った先行実装（→ バックエンドへの確認事項）。
   */
  http.post('*/api/masters/blackout-dates/validate', async ({ request }) => {
    const { blackoutDate, reason } = await readBlackoutDateRequest(request)
    const violation = blackoutDateRequestViolation({ blackoutDate, reason })
    if (violation) return violation

    const query = new URL(request.url).searchParams
    const isUpdate = query.get('is_update') === 'true'
    const currentId = query.has('blackout_date_id') ? Number(query.get('blackout_date_id')) : null
    const target = blackoutDateRows.find((blackout) => blackout.ID === currentId)
    // 同じ日付の行。自分自身は重複に数えない
    const duplicate = blackoutDateRows.find(
      (blackout) =>
        blackout.受注不可日 === blackoutDate &&
        blackout.取消区分 === 0 &&
        blackout.ID !== currentId,
    )

    let error = blackoutDateFormatError(blackoutDate)
    if (!error && isUpdate && (!target || target.取消区分 === 1)) {
      error = `指定された受注不可日(ID=${currentId})は存在しません`
    }
    if (!error && duplicate) {
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
  http.post('*/api/masters/blackout-dates', async ({ request }) => {
    const { blackoutDate, reason } = await readBlackoutDateRequest(request)
    const violation = blackoutDateRequestViolation({ blackoutDate, reason })
    if (violation) return violation

    const formatError = blackoutDateFormatError(blackoutDate)
    if (formatError) return detailError(400, formatError)

    const existing = blackoutDateRows.find((blackout) => blackout.受注不可日 === blackoutDate)
    if (existing && existing.取消区分 === 0) {
      return detailError(400, `受注不可日(${blackoutDate})は既に登録されています`)
    }

    /*
     * 取消済みの行があれば置き換える（＝再有効化。行は増えない）。
     * 主キーは ID になったが、**再有効化では元の行の ID を引き継ぐ**（同じ行が生き返る）。
     * 重複の判断は主キーではなく受注不可日の一意制約で行う。
     */
    const created = toMockBlackoutDateItem({
      id: existing ? existing.ID : nextBlackoutDateId(),
      blackoutDate,
      reason,
      reactivated: Boolean(existing),
    })
    blackoutDateRows = existing
      ? blackoutDateRows.map((blackout) => (blackout.ID === existing.ID ? created : blackout))
      : [...blackoutDateRows, created]

    return HttpResponse.json(
      { success: true, blackout_date: created, message: '受注不可日を登録しました' },
      { status: 201 },
    )
  }),

  /*
   * 受注不可日の更新（日付と理由の両方を変更できる）。
   * パスが対象の ID、本文の 受注不可日 が変更後の日付。
   *
   * **パスキーは ID。** 取り込み時点の openapi.json はまだ
   * `/masters/blackout-dates/{blackout_date}`（受注不可日・integer）だが、DB の主キーを id に
   * 寄せる方針に合わせて先に置いている（src/mocks/handlers の銘柄と同じ）。
   *
   * 検査の順序が要点で、「対象が居るか → 入力の形 → 盤面が古くないか → 他の行との重複」と見る。
   * 競合（409）を重複より先に見るのは、他の利用者が書き換えた後の行に
   * 「その日付は既に登録されています」と返すと理由を取り違えさせるため。
   * まず「盤面が古い」ことを伝える。
   */
  http.put('*/api/masters/blackout-dates/:id', async ({ params, request }) => {
    const targetId = Number(params.id)
    const { blackoutDate, reason, updatedAt } = await readBlackoutDateRequest(request)
    const violation = blackoutDateRequestViolation({ blackoutDate, reason })
    if (violation) return violation

    const current = blackoutDateRows.find(
      (blackout) => blackout.ID === targetId && blackout.取消区分 === 0,
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

    // 重複の根拠は主キーではなく日付の一意制約。自分自身（同じ ID）は重複に数えない
    if (
      blackoutDateRows.some(
        (blackout) =>
          blackout.受注不可日 === blackoutDate &&
          blackout.取消区分 === 0 &&
          blackout.ID !== targetId,
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
     * 主キーが ID になったので、日付を変えた更新も「同じ行の日付列を書き換える」だけで済む。
     * （日付が主キーだった頃は、元の日付の行を消して新しい日付の行を置き直していた）
     */
    blackoutDateRows = blackoutDateRows.map((blackout) =>
      blackout.ID === targetId ? updated : blackout,
    )

    return HttpResponse.json({
      success: true,
      blackout_date: updated,
      message: '受注不可日を更新しました',
    })
  }),

  // 受注不可日の論理削除。行は残したまま取消区分を 1 にする（パスキーは PUT と同じく ID）
  http.delete('*/api/masters/blackout-dates/:id', ({ params }) => {
    const targetId = Number(params.id)
    const target = blackoutDateRows.find(
      (blackout) => blackout.ID === targetId && blackout.取消区分 === 0,
    )

    if (!target) {
      return detailError(404, '指定された受注不可日が存在しないか、既に削除されています')
    }

    const deleted = { ...target, 取消区分: 1, 取消日時: nowIsoTimestamp(), 取消者: '006' }
    blackoutDateRows = blackoutDateRows.map((blackout) =>
      blackout.ID === targetId ? deleted : blackout,
    )

    return HttpResponse.json({
      success: true,
      blackout_date: deleted,
      message: '受注不可日を削除しました',
    })
  }),
]

/* ここから受注不可日（/masters/blackout-dates）のモック用ヘルパ。実 API の形に合わせるためだけのもの */

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

/** ID の採番。実 API の AUTO_INCREMENT と同じく単調増加（取消済みの行も母数に入れる） */
function nextBlackoutDateId() {
  return Math.max(0, ...blackoutDateRows.map((blackout) => blackout.ID)) + 1
}

/**
 * BlackoutDateItem を組み立てる（登録・再有効化の応答用）。
 *
 * **再有効化では取消済みの行の ID をそのまま渡す**（行も id も増やさない）。
 * 実 API がどちらの仕様になるかは未確定（→ バックエンドへの確認事項）。
 */
function toMockBlackoutDateItem({ id, blackoutDate, reason, reactivated = false }) {
  return {
    ID: id,
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

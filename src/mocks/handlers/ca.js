import { http, HttpResponse } from 'msw'
import {
  CA_TYPE_NAMES,
  caStocks,
  canceledCorporateActions,
  corporateActions,
  formatRatio,
} from '../fixtures/ca'
import {
  detailError,
  isRealYmd,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/**
 * CAマスタの行。登録したものが一覧に出るところまで再現したいので書き換え可能に持つ。
 * 取消済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
let caRows = [...corporateActions, ...canceledCorporateActions]

/** モックの可変状態をフィクスチャの内容に戻す（vitest.setup.js の afterEach から index.js 経由で呼ばれる） */
export function resetCaRows() {
  caRows = [...corporateActions, ...canceledCorporateActions]
}

/**
 * CA の並び順。実 API（ca_repository.list）の
 * `ORDER BY COALESCE(効力発生日, 権利付最終日, 99999999) DESC, ID DESC` と同じ。
 * 日付は YYYYMMDD の integer なので、数値の大小がそのまま日付の大小になる。
 */
function caSortKey(ca) {
  return ca.効力発生日 ?? ca.権利付最終日 ?? 99999999
}

export const caHandlers = [
  /*
   * CAマスタ（コーポレートアクション）の一覧。取消済み（取消区分 1）は既定で返さない。
   * 銘柄コードの絞り込みは実 API と同じ**部分一致**で、銘柄コードか Ticker のどちらかに当たればよい
   * （実 API は `銘柄コード LIKE %s OR Ticker LIKE %s`）。
   * CSV 入出力と更新履歴（/masters/ca/export-csv ほか）は画面が使わないのでモックしない。
   */
  http.get('*/api/masters/ca', ({ request }) => {
    const params = new URL(request.url).searchParams
    // DB 照合は大文字小文字を区別しないので、モックも大文字に寄せてから比べる
    // クエリ名は 2026-09-16 の仕様取り込みで stock_code から symbol に改名された
    const stockCode = (params.get('symbol') ?? '').trim().toUpperCase()
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
  http.post('*/api/masters/ca/validate', async ({ request }) => {
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
  http.post('*/api/masters/ca', async ({ request }) => {
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
  http.put('*/api/masters/ca/:caId', async ({ params, request }) => {
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
  http.delete('*/api/masters/ca/:caId', ({ params }) => {
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
]

/* ここから CAマスタ（/masters/ca）のモック用ヘルパ。実 API の形に合わせるためだけのもの */

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

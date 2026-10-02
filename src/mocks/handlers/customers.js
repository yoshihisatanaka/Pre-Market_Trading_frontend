import { http, HttpResponse } from 'msw'
import { branches, codeName, salesHandlers } from '../fixtures/codes'
import {
  DOCUMENT_NAMES,
  SPECIFIC_ACCOUNT_NAMES,
  SUSPENSION_NAMES,
  canceledCustomers,
  customers,
} from '../fixtures/customers'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/**
 * 顧客マスタの行。登録・更新で書き換わるので、テスト間で持ち越さないよう
 * resetCustomerRows() を resetMockState() に登録してある。
 * 削除済みも持つのは、一覧が取消区分で外していることと、登録が再有効化になることを確かめるため。
 * 削除（DELETE）のハンドラは持たない（画面が削除を実装しないため）。
 */
let customerRows = cloneRows()

function cloneRows() {
  return [...customers, ...canceledCustomers].map((row) => ({ ...row }))
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetCustomerRows() {
  customerRows = cloneRows()
}

/**
 * 口座番号で有効な 1 件を引く。
 *
 * 残高マスタのモックが、実 API の「m_口座情報 と結合して扱者・顧客名を返す」を模すために使う。
 * 行の配列そのものは export しない（他のファイルから書き換えられないようにするため）。
 */
export function findCustomerByAccountNo(accountNo) {
  return customerRows.find((row) => row.口座番号 === accountNo && row.取消区分 === 0) ?? null
}

/**
 * 顧客マスタの一覧が 1 ページで返す件数の既定値。
 * `/masters/customers` は limit（1〜200・既定 50）を受け取るので、
 * これはクエリが無いときに使う値。
 */
const CUSTOMERS_DEFAULT_LIMIT = 50

/** CustomerRequest の required（openapi.json）。事前検証と登録で「未入力」を見る */
const REQUIRED_KEYS = [
  '口座番号',
  '部店コード',
  '扱者コード',
  '法人区分',
  '顧客名',
  '顧客名カナ',
  'コンプラランク',
  'VWAP書類受入',
  'リスク外株書類受入',
  '外国証券同意書受入',
  '総預り資産',
  'NISA契約',
  '取引停止区分_全取引',
  '取引停止区分_エクイティ商品取引_売買',
  '取引停止区分_リスク商品取引_売買',
  '取引停止区分_エクイティ商品取引_買',
  '取引停止区分_リスク商品取引_買',
  '特定口座区分',
]

/** 本文に載ってよい入力項目（CustomerRequest の properties。更新日時 を除く） */
const INPUT_KEYS = [
  ...REQUIRED_KEYS,
  '生年月日',
  '投資方針',
  'NISA買付可能額_当年',
  'NISA買付可能額_翌年',
  '円貨預り金',
  '外貨預り金',
  '口座区分',
  '事故処理口座区分',
]

/** CustomerRequest の既定値（登録で省かれた項目に入る） */
const CREATE_DEFAULTS = {
  NISA買付可能額_当年: 0,
  NISA買付可能額_翌年: 0,
  円貨預り金: 0,
  外貨預り金: 0,
  口座区分: '0',
  事故処理口座区分: '0',
}

export const customerHandlers = [
  /*
   * 顧客マスタの一覧。削除済み（取消区分 1）は既定で返さない。
   * クエリ名は実 API に合わせて英語の snake_case。顧客名だけ 顧客名 / 顧客名カナ への
   * 部分一致で、ほかは完全一致（実 API の m_口座情報 の検索と同じ）。
   *
   * handler_code / restriction / account_type / corporate_type は
   * `/masters/customers` に無いクエリで、画面モックにある検索条件をモックだけで
   * 成立させるためのもの（handler_code は旧 `/customers` にはある）。
   * 実 API に切り替えるときは仕様追加を依頼する。
   */
  http.get('*/api/masters/customers', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = params.get('branch_code') ?? ''
    const handlerCode = params.get('handler_code') ?? ''
    const accountNo = toNonNegativeInt(params.get('account_no'), 0)
    const customerName = (params.get('customer_name') ?? '').trim()
    const restriction = params.get('restriction') ?? ''
    const accountType = params.get('account_type') ?? ''
    const corporateType = params.get('corporate_type') ?? ''
    const includeDeleted = params.get('include_deleted') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), CUSTOMERS_DEFAULT_LIMIT)
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
      // CustomerListResponse は limit / offset も返す
      limit,
      offset,
      customers: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 事前検証（DB は変えない）。`is_update` と `account_id` で新規検証と変更検証が切り替わる。
   * CustomerValidateRequest は 口座番号 だけが required なので、未入力はここで errors に積む
   * （登録の POST なら pydantic の 422 になる項目）。
   *
   * 取消済みの同じ口座番号への新規登録は、実 API では再有効化になる（POST の description）。
   * 登録はできるが利用者に確かめたいので、ここでは警告として返す（海外休場日マスタと同じ扱い）。
   */
  http.post('*/api/masters/customers/validate', async ({ request }) => {
    const body = await request.json().catch(() => null)
    if (!body || body.口座番号 === undefined || body.口座番号 === null) {
      return requestValidationError(['body', '口座番号'], 'Field required', 'missing')
    }

    const query = new URL(request.url).searchParams
    const isUpdate = query.get('is_update') === 'true'
    const currentId = query.has('account_id') ? Number(query.get('account_id')) : null

    const errors = [...missingErrors(body), ...codeErrors(body)]
    const warnings = []

    if (isUpdate) {
      const target = customerRows.find((row) => row.ID === currentId && row.取消区分 === 0)
      if (!target) errors.push(`指定された口座(ID=${currentId})は存在しません`)
    } else {
      const sameNumber = customerRows.filter((row) => row.口座番号 === body.口座番号)
      if (sameNumber.some((row) => row.取消区分 === 0)) {
        errors.push(`口座番号 ${body.口座番号} は既に登録されています`)
      } else if (sameNumber.length > 0) {
        warnings.push(`口座番号 ${body.口座番号} は削除済みです。登録すると再有効化されます`)
      }
    }

    return HttpResponse.json({
      valid: errors.length === 0,
      errors,
      warnings: errors.length === 0 ? warnings : [],
      details: null,
    })
  }),

  /*
   * 新規登録。必須の欠けは pydantic の 422、コード値と重複はサービス層の 400。
   * 取消済みの同じ口座番号があれば、その行を再有効化する（ID を引き継ぐ。新規行は増えない）。
   */
  http.post('*/api/masters/customers', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const missing = REQUIRED_KEYS.find((key) => body?.[key] === undefined || body?.[key] === null)
    if (missing) return requestValidationError(['body', missing], 'Field required', 'missing')

    const errors = codeErrors(body)
    if (errors.length > 0) return detailError(400, errors[0])

    const sameNumber = customerRows.filter((row) => row.口座番号 === body.口座番号)
    if (sameNumber.some((row) => row.取消区分 === 0)) {
      return detailError(400, `口座番号 ${body.口座番号} は既に登録されています`)
    }

    const revived = sameNumber[0] ?? null
    const now = nowIsoTimestamp()
    const created = withNames({
      ...(revived ?? {}),
      ...CREATE_DEFAULTS,
      ...pickInput(body),
      ID: revived?.ID ?? nextId(),
      取消区分: 0,
      ユーザー操作フラグ: 1,
      作成日時: revived?.作成日時 ?? now,
      作成者: revived?.作成者 ?? 'admin',
      更新日時: now,
      更新者: 'admin',
      取消日時: null,
      取消者: null,
    })
    customerRows = revived
      ? customerRows.map((row) => (row.ID === revived.ID ? created : row))
      : [...customerRows, created]

    return HttpResponse.json(
      { success: true, account: created, message: '口座情報を登録しました' },
      { status: 201 },
    )
  }),

  /*
   * 1 件の取得（顧客詳細）。パスキーは行 ID。削除済みの行は 404 にする（一覧と同じく有効な行だけを見せる）。
   * 同じ形のパス（/masters/customers/export-csv など。GET）も当たるので、数字でない ID は
   * 何も返さずに後ろのハンドラ（無ければ実 API）へ流す（MSW は undefined を「次へ」と扱う）。
   */
  http.get('*/api/masters/customers/:id', ({ params }) => {
    if (!/^\d+$/.test(params.id)) return undefined

    const row = customerRows.find((customer) => customer.ID === Number(params.id))
    if (!row || row.取消区分 !== 0) return detailError(404, '指定された口座情報が存在しません')

    return HttpResponse.json({ account: row })
  }),

  /*
   * 更新（部分更新）。本文に含めた項目だけを変え、null は「クリア」。口座番号は変えられない
   * （CustomerUpdateRequest に無い。送られても捨てる）。
   * 検査の順序は銘柄マスタと同じ「対象が居るか(404) → 値の妥当性(400) → 盤面が古くないか(409)」。
   */
  http.put('*/api/masters/customers/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) ?? {}
    const targetId = Number(params.id)
    const current = customerRows.find((row) => row.ID === targetId && row.取消区分 === 0)
    if (!current) return detailError(404, '指定された口座情報が存在しません')

    const merged = { ...current, ...pickInput(body), 口座番号: current.口座番号 }
    const errors = codeErrors(merged)
    if (errors.length > 0) return detailError(400, errors[0])

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    if (!isSameTimestamp(body.更新日時 ?? null, current.更新日時)) {
      return detailError(
        409,
        '他のユーザーによって口座情報が更新されています。最新データを再取得してください。',
      )
    }

    const updated = withNames({
      ...merged,
      ユーザー操作フラグ: 1,
      更新日時: nowIsoTimestamp(),
      更新者: 'admin',
    })
    customerRows = customerRows.map((row) => (row.ID === targetId ? updated : row))

    return HttpResponse.json({ success: true, account: updated, message: '口座情報を更新しました' })
  }),
]

/* ここから顧客マスタのモック用ヘルパ。実 API のサービス層の検証と名前の付与を模すためだけのもの */

/** 本文から入力項目だけを取り出す（含まれていないキーは取り出さない＝部分更新） */
function pickInput(body) {
  return Object.fromEntries(INPUT_KEYS.filter((key) => key in body).map((key) => [key, body[key]]))
}

function missingErrors(body) {
  return REQUIRED_KEYS.filter((key) => body[key] === undefined || body[key] === null).map(
    (key) => `${key}は必須です`,
  )
}

/** 部店・扱者のマスタ照合（実 API の「部店・扱者マスタおよびコード値検証」の一部） */
function codeErrors(body) {
  const errors = []
  if (body.部店コード && !branches.some((branch) => branch.code === body.部店コード)) {
    errors.push(`部店コード ${body.部店コード} は存在しません`)
  }
  if (body.扱者コード && !salesHandlers.some((handler) => handler.code === body.扱者コード)) {
    errors.push(`扱者コード ${body.扱者コード} は存在しません`)
  }
  return errors
}

function nextId() {
  return Math.max(0, ...customerRows.map((row) => row.ID)) + 1
}

/** 行のコードから表示名と年齢を付け直す（実 API の「自動算出項目の付与」） */
function withNames(row) {
  return {
    ...row,
    部店名: branches.find((branch) => branch.code === row.部店コード)?.name ?? null,
    扱者名: salesHandlers.find((handler) => handler.code === row.扱者コード)?.name ?? null,
    法人区分名: codeName('法人区分', row.法人区分),
    年齢: ageOf(row.生年月日),
    コンプラランク名: row.コンプラランク ?? null,
    投資方針名: codeName('投資方針', row.投資方針, row.法人区分),
    VWAP書類受入名: DOCUMENT_NAMES[row.VWAP書類受入] ?? null,
    リスク外株書類受入名: DOCUMENT_NAMES[row.リスク外株書類受入] ?? null,
    外国証券同意書受入名: DOCUMENT_NAMES[row.外国証券同意書受入] ?? null,
    NISA契約名: { 0: '未契約', 1: '契約', 9: '解約済' }[row.NISA契約] ?? null,
    取引停止区分_全取引名: codeName('取引停止区分_全取引', row.取引停止区分_全取引),
    取引停止区分_エクイティ商品取引_売買名:
      SUSPENSION_NAMES[row.取引停止区分_エクイティ商品取引_売買] ?? null,
    取引停止区分_リスク商品取引_売買名:
      SUSPENSION_NAMES[row.取引停止区分_リスク商品取引_売買] ?? null,
    取引停止区分_エクイティ商品取引_買名:
      SUSPENSION_NAMES[row.取引停止区分_エクイティ商品取引_買] ?? null,
    取引停止区分_リスク商品取引_買名: SUSPENSION_NAMES[row.取引停止区分_リスク商品取引_買] ?? null,
    特定口座区分名: SPECIFIC_ACCOUNT_NAMES[row.特定口座区分] ?? null,
    口座区分名: codeName('口座区分', row.口座区分),
    事故処理口座区分名: row.事故処理口座区分 === '1' ? '事故処理' : '通常',
  }
}

/** 生年月日（YYYYMMDD）→ 年齢の文字列。法人（'0'）や未設定は空文字 */
function ageOf(birthDate) {
  if (!/^\d{8}$/.test(birthDate ?? '')) return ''
  const today = new Date()
  const year = Number(birthDate.slice(0, 4))
  const monthDay = Number(birthDate.slice(4))
  const todayMonthDay = (today.getMonth() + 1) * 100 + today.getDate()
  return String(today.getFullYear() - year - (todayMonthDay < monthDay ? 1 : 0))
}

import { http, HttpResponse } from 'msw'
import { balanceAdjustments, canceledBalanceAdjustments } from '../fixtures/balanceAdjustments'
import { SPECIFIC_DEPOSIT_NAMES } from '../fixtures/codes'
import { findCustomerByAccountNo } from './customers'
import { findSymbolRow } from './symbols'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/**
 * 残高マスタの行。登録・更新したものが一覧に出るところまで再現したいので書き換え可能に持つ。
 * 削除済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
let balanceAdjustmentRows = [...balanceAdjustments, ...canceledBalanceAdjustments]

/** 残高マスタの一覧が 1 ページで返す件数の既定値（実 API は limit 1〜200・既定 50） */
const BALANCE_ADJUSTMENTS_DEFAULT_LIMIT = 50

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetBalanceAdjustmentRows() {
  balanceAdjustmentRows = [...balanceAdjustments, ...canceledBalanceAdjustments]
}

export const balanceAdjustmentHandlers = [
  /*
   * 残高マスタの一覧。削除済み（取消区分 1）は既定で返さない。
   *
   * クエリ名は実 API に合わせて英語の snake_case。`symbol` は 銘柄コード と Ticker の
   * どちらにも当たる部分一致（実 API の `LIKE %s` に合わせ、大文字に寄せてから比べる）で、
   * `customer_name` は 顧客名 / 顧客名カナ への部分一致。
   * `branch_code` と `account_no` は完全一致。
   *
   * **`symbol_name`（銘柄名）は `/masters/balance-adjustments` に無いクエリ。**
   * 画面モックの検索欄を成立させるためにここだけが解釈する（実 API に切り替えると
   * この欄は黙って効かなくなる。仕様追加を依頼する対象 → src/api/balanceAdjustments.js）。
   *
   * 事前検証・削除・更新履歴・CSV 入出力は画面が使わないのでモックしない。
   */
  http.get('*/api/masters/balance-adjustments', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = params.get('branch_code') ?? ''
    const accountNo = toNonNegativeInt(params.get('account_no'), 0)
    // DB 照合は大文字小文字を区別しないので、モックも大文字に寄せてから比べる
    const symbol = (params.get('symbol') ?? '').trim().toUpperCase()
    const customerName = (params.get('customer_name') ?? '').trim()
    const symbolName = (params.get('symbol_name') ?? '').trim().toUpperCase()
    const includeDeleted = params.get('include_deleted') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), BALANCE_ADJUSTMENTS_DEFAULT_LIMIT)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = balanceAdjustmentRows
      .filter(
        (row) =>
          (includeDeleted || row.取消区分 === 0) &&
          (!branchCode || row.部店コード === branchCode) &&
          (!accountNo || row.口座番号 === accountNo) &&
          (!symbol ||
            row.銘柄コード.toUpperCase().includes(symbol) ||
            (row.Ticker ?? '').toUpperCase().includes(symbol)) &&
          (!customerName ||
            (row.顧客名 ?? '').includes(customerName) ||
            (row.顧客名カナ ?? '').includes(customerName)) &&
          (!symbolName || (row.銘柄名 ?? '').toUpperCase().includes(symbolName)),
      )
      /*
       * 実 API の ORDER BY は仕様に書かれていないので、口座番号 → 銘柄コード の昇順を仮に置く。
       * 人が読むときは顧客ごとに保有がまとまっているほうが追いやすい
       * （実 API の並びはバックエンドへの確認事項）。
       */
      .sort((a, b) => a.口座番号 - b.口座番号 || a.銘柄コード.localeCompare(b.銘柄コード))

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      balances: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 残高の新規登録（画面モックの「新規保有を追加」）。ID はサーバが採番する。
   *
   * 同じ 口座番号 × 銘柄コード × 特定預り区分 の有効な行があれば重複として弾く
   * （実 API 側の一意制約を模したもの。仕様には明記が無い → バックエンドへの確認事項）。
   */
  http.post('*/api/masters/balance-adjustments', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = balanceRequestViolation(body)
    if (violation) return violation

    const input = toBalanceInput(body)
    const duplicated = balanceAdjustmentRows.some(
      (row) =>
        row.取消区分 === 0 &&
        row.口座番号 === input.accountNo &&
        row.銘柄コード.toUpperCase() === input.symbolCode.toUpperCase() &&
        row.特定預り区分 === input.specificDeposit,
    )
    if (duplicated) {
      return detailError(400, '同じ口座・銘柄・口座区分の残高が既に登録されています')
    }

    const created = toMockBalanceItem(input, {
      operator: request.headers.get('X-User-Code') || '006',
    })
    balanceAdjustmentRows = [...balanceAdjustmentRows, created]

    return HttpResponse.json(
      { success: true, balance: created, message: '残高を登録しました' },
      { status: 201 },
    )
  }),

  /*
   * 残高の更新（画面モックの「数量を加算」）。
   * 本文は部分更新（BalanceAdjustmentUpdateRequest）で、`残高` だけを書き換える。
   *
   * 検査の順序は銘柄・CA と同じ「本文の形(422) → 対象が居るか(404) → 値の妥当性(400) →
   * 盤面が古くないか(409)」。
   */
  http.put('*/api/masters/balance-adjustments/:id', async ({ params, request }) => {
    const body = await request.json().catch(() => null)
    const balance = body?.残高

    if (balance !== undefined && !Number.isInteger(balance)) {
      return requestValidationError(
        ['body', '残高'],
        'Input should be a valid integer',
        'int_parsing',
      )
    }
    if (balance === undefined) {
      return requestValidationError(['body'], 'Field required', 'missing')
    }

    const found = findUpdatable(params.id)
    if (found.error) return found.error

    if (balance < 0) {
      return detailError(400, '残高は 0 以上で指定してください')
    }
    const conflict = staleError(found.current, body)
    if (conflict) return conflict

    const updated = applyUpdate(found.current, { 残高: balance }, request)
    return HttpResponse.json({ success: true, balance: updated, message: '残高を更新しました' })
  }),

  /*
   * 売却可否の切り替え（画面モックの「売却を停止 / 売却停止を解除」）。
   * 本文は SellProhibitedUpdateRequest（`売却不可区分` 0 / 1 が必須・`更新日時` 任意）。
   * 残高そのものは変えない。検査の順序は数量の更新と同じ。
   */
  http.put('*/api/masters/balance-adjustments/:id/sell-prohibited', async ({ params, request }) => {
    const body = await request.json().catch(() => null)
    const sellProhibited = body?.売却不可区分

    if (sellProhibited === undefined) {
      return requestValidationError(['body', '売却不可区分'], 'Field required', 'missing')
    }
    if (![0, 1].includes(sellProhibited)) {
      return requestValidationError(
        ['body', '売却不可区分'],
        'Input should be less than or equal to 1',
        'less_than_equal',
      )
    }

    const found = findUpdatable(params.id)
    if (found.error) return found.error
    const conflict = staleError(found.current, body)
    if (conflict) return conflict

    const updated = applyUpdate(found.current, { 売却不可区分: sellProhibited }, request)
    return HttpResponse.json({ success: true, balance: updated, message: '売却不可区分を更新しました' })
  }),
]

/** 更新の対象行（取消されていないもの）を探す。居なければ 404 を error に入れて返す */
function findUpdatable(id) {
  const targetId = Number(id)
  const current = balanceAdjustmentRows.find((row) => row.ID === targetId && row.取消区分 === 0)
  return current ? { current } : { error: detailError(404, '指定された残高データが存在しません') }
}

/** 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば 409 を返す */
function staleError(current, body) {
  if (isSameTimestamp(body?.更新日時 ?? null, current.更新日時)) return null
  return detailError(
    409,
    '他のユーザーによって残高データが更新されています。最新データを再取得してください。',
  )
}

/** 送られてきた項目だけを書き換え（部分更新）、行を差し替えて更新後の 1 件を返す */
function applyUpdate(current, changes, request) {
  const updated = {
    ...current,
    ...changes,
    // 手で補正された行になるので、印と更新の記録を立てる
    ユーザー操作フラグ: 1,
    更新日時: nowIsoTimestamp(),
    /*
     * 更新者は送られてきた X-User-Code をそのまま記録する（他のマスタのモックは '006' を
     * 決め打つが、この画面は確認ステップで更新者を見せるので、そこと食い違わせない）。
     */
    更新者: request.headers.get('X-User-Code') || '006',
  }
  balanceAdjustmentRows = balanceAdjustmentRows.map((row) =>
    row.ID === current.ID ? updated : row,
  )
  return updated
}

/**
 * BalanceAdjustmentRequest の形（pydantic）で弾かれるものを 422 で返す。
 * 必須は 口座番号 / 銘柄コード / 特定預り区分 / 残高 の 4 つ。
 * 部店コード は任意（未入力ならサーバが口座情報から補完する）。
 */
function balanceRequestViolation(body) {
  if (!body || typeof body !== 'object') {
    return requestValidationError(['body'], 'Input should be a valid dictionary', 'dict_type')
  }
  if (!Number.isInteger(body.口座番号)) {
    return requestValidationError(
      ['body', '口座番号'],
      'Input should be a valid integer',
      'int_parsing',
    )
  }
  if (typeof body.銘柄コード !== 'string' || body.銘柄コード.length === 0) {
    return requestValidationError(['body', '銘柄コード'], 'Field required', 'missing')
  }
  if (body.銘柄コード.length > 14) {
    return requestValidationError(
      ['body', '銘柄コード'],
      'String should have at most 14 characters',
      'string_too_long',
    )
  }
  if (!SPECIFIC_DEPOSIT_NAMES[body.特定預り区分]) {
    return requestValidationError(
      ['body', '特定預り区分'],
      "Input should be '0', '1', '4', '6' or '8'",
      'enum',
    )
  }
  if (!Number.isInteger(body.残高) || body.残高 < 0) {
    return requestValidationError(
      ['body', '残高'],
      'Input should be greater than or equal to 0',
      'greater_than_equal',
    )
  }

  return null
}

/** BalanceAdjustmentRequest → モックが扱いやすい形 */
function toBalanceInput(body) {
  return {
    branchCode: body.部店コード ?? '',
    accountNo: body.口座番号,
    symbolCode: body.銘柄コード,
    specificDeposit: body.特定預り区分,
    balance: body.残高,
  }
}

/**
 * BalanceAdjustmentItem を組み立てる（新規登録の応答用）。
 *
 * 顧客と銘柄の付帯情報（扱者・顧客名・Ticker・銘柄名）は、実 API が
 * m_口座情報 / m_銘柄情報 と結合して返すもの。モックも同じ出どころから引く。
 * 銘柄が見つからない場合（画面が新しいティッカーを送ってくる経路）は、
 * 送られた銘柄コードをそのまま Ticker として返し、銘柄名は null にする。
 */
function toMockBalanceItem(input, { operator = '006' } = {}) {
  const customer = findCustomerByAccountNo(input.accountNo)
  const symbol = findSymbolRow(input.symbolCode)
  const nextId = Math.max(0, ...balanceAdjustmentRows.map((row) => row.ID)) + 1

  return {
    ID: nextId,
    // 未入力なら口座情報から補完する（実 API の「未入力時は口座情報より補完」）
    部店コード: input.branchCode || (customer?.部店コード ?? null),
    口座番号: input.accountNo,
    銘柄コード: input.symbolCode,
    特定預り区分: input.specificDeposit,
    特定預り区分名: SPECIFIC_DEPOSIT_NAMES[input.specificDeposit] ?? null,
    預り区分名: SPECIFIC_DEPOSIT_NAMES[input.specificDeposit] ?? null,
    // 手で足した保有なので、バッチ取込時の元残高は持たない
    初期残高: null,
    残高: input.balance,
    扱者コード: customer?.扱者コード ?? null,
    扱者名: customer?.扱者名 ?? null,
    顧客名: customer?.顧客名 ?? null,
    顧客名カナ: customer?.顧客名カナ ?? null,
    Ticker: symbol?.Ticker ?? input.symbolCode,
    銘柄名: symbol?.銘柄名_英字 ?? null,
    // 追加した保有は売却可から始める（画面モックに登録時の指定が無い）
    売却不可区分: 0,
    取消区分: 0,
    ユーザー操作フラグ: 1,
    作成日時: nowIsoTimestamp(),
    作成者: operator,
    更新日時: nowIsoTimestamp(),
    更新者: operator,
    取消日時: null,
    取消者: null,
  }
}

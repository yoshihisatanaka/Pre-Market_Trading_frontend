import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { ApiError } from './client'
import {
  createCustomer,
  fetchCustomer,
  fetchCustomers,
  updateCustomer,
  validateCustomer,
} from './customers'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を検証する。
 *
 * ストア・画面のテストはモックが返す結果を見ているので、モックとサーバの理解がずれていても
 * 気づけない。この層でクエリ名・値の型・応答のキーを固定しておくと、
 * ずれが 1 か所で見つかる。
 *
 * シナリオ: docs/unit/api-customers.md
 */

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get('*/api/masters/customers', ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams }
      return HttpResponse.json(body, { status })
    }),
  )
}

/**
 * CustomerItem 1 件。フィクスチャの先頭行をそのまま使う
 * （項目の取りこぼしが起きないよう、期待値の材料も同じ行から取る）。
 */
const customerItem = customers[0]

const listBody = (rows) => ({ total: rows.length, limit: 50, offset: 0, customers: rows })

/*
 * ここから事前検証・登録・更新用。
 *
 * アプリ内のキー ↔ 実 API のキーの対応は、実装の CUSTOMER_FIELDS を読まずにここへ書き写して固定する
 * （読むと実装の取り違えがそのまま期待値になる）。項目が増えたらここにも 1 行足す。
 */
const FIELD_MAP = [
  ['accountNumber', '口座番号'],
  ['branchCode', '部店コード'],
  ['handlerCode', '扱者コード'],
  ['corporateType', '法人区分'],
  ['customerName', '顧客名'],
  ['customerNameKana', '顧客名カナ'],
  ['birthDate', '生年月日'],
  ['complianceRank', 'コンプラランク'],
  ['investmentPolicy', '投資方針'],
  ['vwapDocument', 'VWAP書類受入'],
  ['riskDocument', 'リスク外株書類受入'],
  ['foreignConsent', '外国証券同意書受入'],
  ['totalAssets', '総預り資産'],
  ['nisaContract', 'NISA契約'],
  ['growthQuota', 'NISA買付可能額_当年'],
  ['growthQuotaNext', 'NISA買付可能額_翌年'],
  ['cashJpy', '円貨預り金'],
  ['cashUsd', '外貨預り金'],
  ['suspendAll', '取引停止区分_全取引'],
  ['suspendEquityTrade', '取引停止区分_エクイティ商品取引_売買'],
  ['suspendRiskTrade', '取引停止区分_リスク商品取引_売買'],
  ['suspendEquityBuy', '取引停止区分_エクイティ商品取引_買'],
  ['suspendRiskBuy', '取引停止区分_リスク商品取引_買'],
  ['specificAccountType', '特定口座区分'],
  ['accountType', '口座区分'],
  ['accidentAccountType', '事故処理口座区分'],
]

/** 任意項目（CustomerRequest の required に無い）。空欄の扱いを見るのに使う */
const OPTIONAL_KEYS = [
  'birthDate',
  'investmentPolicy',
  'growthQuota',
  'growthQuotaNext',
  'cashJpy',
  'cashUsd',
  'accountType',
  'accidentAccountType',
]

const apiKeyOf = (key) => FIELD_MAP.find(([appKey]) => appKey === key)[1]

/** 生の CustomerItem → フォームの値（入力欄は文字列で持つ。null は空欄） */
const formOf = (raw) =>
  Object.fromEntries(
    FIELD_MAP.map(([key, apiKey]) => [key, raw[apiKey] === null ? '' : String(raw[apiKey])]),
  )

/** 登録・事前検証で送られるはずの本文（値のある項目だけ。型は生の形のまま） */
const createBodyOf = (raw) =>
  Object.fromEntries(
    FIELD_MAP.filter(([, apiKey]) => raw[apiKey] !== null).map(([, apiKey]) => [
      apiKey,
      raw[apiKey],
    ]),
  )

/** 任意項目を空欄にしたフォーム */
const withBlankOptionals = (form) => ({
  ...form,
  ...Object.fromEntries(OPTIONAL_KEYS.map((key) => [key, ''])),
})

/**
 * 書き込み系のリクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'post'|'put'} method
 * @param {string} path '*\/api' より後ろ（:id のようなパラメータを含めてよい）
 */
function recordWrite(method, path, body, status = 200) {
  server.use(
    http[method](`*/api${path}`, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams, body: await request.json() }
      return HttpResponse.json(body, { status })
    }),
  )
}

const VALID = { valid: true, errors: [], warnings: [], details: null }

// フィクスチャの先頭行がすべての項目に値を持つ前提（空欄の扱いは個別に作る）
const fullForm = formOf(customerItem)

describe('api/customers', () => {
  it('[CUA-01] 引数なしの一覧取得は limit と offset だけを送る', async () => {
    record(listBody([]))

    await fetchCustomers()

    expect(lastRequest.url.pathname).toBe('/api/masters/customers')
    expect(lastRequest.params.get('limit')).toBe('50')
    expect(lastRequest.params.get('offset')).toBe('0')
    // ページングの 2 つだけ。絞り込みは条件が無ければ送らない
    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
    expect(lastRequest.params.has('include_deleted')).toBe(false)
  })

  it('[CUA-02] 絞り込み条件は英語の snake_case で送る', async () => {
    record(listBody([]))

    await fetchCustomers({
      branchCode: customerItem.部店コード,
      handlerCode: customerItem.扱者コード,
      customerName: customerItem.顧客名,
    })

    expect(lastRequest.params.get('branch_code')).toBe(customerItem.部店コード)
    expect(lastRequest.params.get('customer_name')).toBe(customerItem.顧客名)
    // handler_code は /masters/customers に無いクエリ。いまはモックだけが解釈する
    expect(lastRequest.params.get('handler_code')).toBe(customerItem.扱者コード)
  })

  it('[CUA-03] 空文字の条件はクエリに載せない', async () => {
    record(listBody([]))

    await fetchCustomers({
      branchCode: '',
      handlerCode: '',
      accountNumber: '',
      customerName: '',
      restriction: '',
      accountType: '',
      corporateType: '',
    })

    expect([...lastRequest.params.keys()]).toEqual(['limit', 'offset'])
  })

  it('[CUA-04] 数字だけの口座番号は integer として送る', async () => {
    record(listBody([]))

    await fetchCustomers({ accountNumber: String(customerItem.口座番号) })

    expect(lastRequest.params.get('account_no')).toBe(String(customerItem.口座番号))
  })

  it('[CUA-05] 数字以外を含む口座番号は送らない', async () => {
    for (const input of ['123-0001', 'abc', ' ', '12 34']) {
      record(listBody([]))

      await fetchCustomers({ accountNumber: input })

      // 文字列のまま送ると実 API が 422 で弾き、理由が画面に出ない
      expect(lastRequest.params.has('account_no')).toBe(false)
    }
  })

  it('[CUA-06] limit と offset をそのまま送る', async () => {
    record(listBody([]))

    await fetchCustomers({ limit: 20, offset: 50 })

    expect(lastRequest.params.get('limit')).toBe('20')
    expect(lastRequest.params.get('offset')).toBe('50')
  })

  it('[CUA-07] openapi に無い区分系の条件も英語のクエリ名で送る', async () => {
    record(listBody([]))

    await fetchCustomers({ restriction: '1', accountType: '2', corporateType: '1' })

    // サーバに追加を依頼したい綴りで送る（いまはモックだけが解釈する）
    expect(lastRequest.params.get('restriction')).toBe('1')
    expect(lastRequest.params.get('account_type')).toBe('2')
    expect(lastRequest.params.get('corporate_type')).toBe('1')
  })

  it('[CUA-08] CustomerItem をアプリ内モデルに変換する', async () => {
    record(listBody([customerItem]))

    const { items, total } = await fetchCustomers()

    expect(total).toBe(1)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      // 主キー。integer の ID を文字列にして運ぶ（行キーと URL で使う）
      id: String(customerItem.ID),
      // 口座番号は主キーではないが、一意な業務コードとして文字列で運ぶ
      accountNumber: String(customerItem.口座番号),
      branchCode: customerItem.部店コード,
      branchName: customerItem.部店名,
      handlerCode: customerItem.扱者コード,
      handlerName: customerItem.扱者名,
      customerName: customerItem.顧客名,
      customerNameKana: customerItem.顧客名カナ,
      age: customerItem.年齢,
      restrictionName: customerItem.取引停止区分_全取引名,
      investmentPolicyName: customerItem.投資方針名,
      complianceRankName: customerItem.コンプラランク名,
      accountTypeName: customerItem.口座区分名,
      corporateTypeName: customerItem.法人区分名,
    })
    expect(typeof items[0].accountNumber).toBe('string')
  })

  it('[CUA-09] 取引停止区分とユーザー操作フラグは boolean になる', async () => {
    record(
      listBody([
        { ...customerItem, 口座番号: 1, 取引停止区分_全取引: 1, ユーザー操作フラグ: 1 },
        { ...customerItem, 口座番号: 2, 取引停止区分_全取引: 0, ユーザー操作フラグ: 0 },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items.map((item) => item.tradingSuspended)).toEqual([true, false])
    expect(items.map((item) => item.userModified)).toEqual([true, false])
  })

  it('[CUA-10] 事故処理口座区分は文字列の 1 のときだけ立つ', async () => {
    record(
      listBody([
        { ...customerItem, 口座番号: 1, 事故処理口座区分: '1' },
        { ...customerItem, 口座番号: 2, 事故処理口座区分: '0' },
        // 取引停止区分と違いこのキーは文字列。integer の 1 では立たない
        { ...customerItem, 口座番号: 3, 事故処理口座区分: 1 },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items.map((item) => item.accidentAccount)).toEqual([true, false, false])
  })

  it('[CUA-11] 金額は数値のまま運び、0 を null に潰さない', async () => {
    record(
      listBody([
        {
          ...customerItem,
          円貨預り金: 3500000,
          外貨預り金: 0,
          NISA買付可能額_当年: null,
        },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items[0]).toMatchObject({
      cashJpy: 3500000,
      // 残高 0 と「値が無い」は意味が違う
      cashUsd: 0,
      growthQuota: null,
    })
  })

  it('[CUA-12] null の文字列項目は空文字に寄せる', async () => {
    record(
      listBody([
        {
          ...customerItem,
          部店名: null,
          扱者名: null,
          顧客名カナ: null,
          年齢: null,
          取引停止区分_全取引名: null,
          投資方針名: null,
          コンプラランク名: null,
          口座区分名: null,
          法人区分名: null,
        },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items[0]).toMatchObject({
      branchName: '',
      handlerName: '',
      customerNameKana: '',
      age: '',
      restrictionName: '',
      investmentPolicyName: '',
      complianceRankName: '',
      accountTypeName: '',
      corporateTypeName: '',
    })
  })

  it('[CUA-13] customers を持たない応答でも空の一覧として扱う', async () => {
    record({ total: 0 })

    const { items, total } = await fetchCustomers()

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('[CUA-14] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchCustomers()).rejects.toBeTruthy()
  })

  /*
   * 実 API が ID を返し始めるまでの穴を見張るテスト。口座番号へフォールバックすると
   * 「動いているように見える」まま実 API で行のキーが壊れるので、空文字のまま出す。
   */
  it('[CUA-15] 応答に ID が無いとき id は空文字のまま（口座番号へフォールバックしない）', async () => {
    const { ID: _id, ...withoutId } = customerItem
    record(listBody([withoutId]))

    const { items } = await fetchCustomers()

    expect(items[0].id).toBe('')
    // 口座番号は主キーではなくなったが、業務上の値としてそのまま出る
    expect(items[0].accountNumber).toBe(String(customerItem.口座番号))
  })

  it('[CUA-16] 事前検証は日本語キーの本文で送り、数値項目は数値にする', async () => {
    // 先頭行が全項目に値を持たないと、型の確認が抜ける
    for (const [, apiKey] of FIELD_MAP) expect(customerItem[apiKey], apiKey).not.toBeNull()
    recordWrite('post', '/masters/customers/validate', VALID)

    await validateCustomer({ ...fullForm, customerName: `  ${customerItem.顧客名}  ` })

    expect(lastRequest.url.pathname).toBe('/api/masters/customers/validate')
    // 新規の検証はクエリを付けない
    expect([...lastRequest.params.keys()]).toEqual([])
    // 前後の空白は落とす。ほかは生の形（型を含む）とそろう
    expect(lastRequest.body).toEqual(createBodyOf(customerItem))
    expect(typeof lastRequest.body.口座番号).toBe('number')
    expect(typeof lastRequest.body.総預り資産).toBe('number')
    expect(typeof lastRequest.body.取引停止区分_全取引).toBe('number')
    expect(typeof lastRequest.body.外貨預り金).toBe('number')
    // 同じ 0/1 でも書類受入・法人区分は文字列
    expect(typeof lastRequest.body.VWAP書類受入).toBe('string')
    expect(typeof lastRequest.body.法人区分).toBe('string')
  })

  it('[CUA-17] 事前検証と登録では空欄の項目をキーごと送らない', async () => {
    const form = withBlankOptionals(fullForm)
    const blankApiKeys = OPTIONAL_KEYS.map(apiKeyOf)

    recordWrite('post', '/masters/customers/validate', VALID)
    await validateCustomer(form)
    for (const apiKey of blankApiKeys) {
      expect(lastRequest.body, apiKey).not.toHaveProperty(apiKey)
    }

    recordWrite('post', '/masters/customers', { success: true, account: customerItem }, 201)
    await createCustomer(form)
    for (const apiKey of blankApiKeys) {
      expect(lastRequest.body, apiKey).not.toHaveProperty(apiKey)
    }
    // 値のある必須項目は載っている
    expect(lastRequest.body.口座番号).toBe(customerItem.口座番号)
  })

  it('[CUA-18] 編集の事前検証は account_id と is_update をクエリで送る', async () => {
    recordWrite('post', '/masters/customers/validate', VALID)

    await validateCustomer({
      ...fullForm,
      id: String(customerItem.ID),
      updatedAt: '2026-09-03T14:20:00',
    })

    expect(lastRequest.params.get('account_id')).toBe(String(customerItem.ID))
    expect(lastRequest.params.get('is_update')).toBe('true')
    // 事前検証は口座番号が必須で、楽観的ロックは照合しない
    expect(lastRequest.body.口座番号).toBe(customerItem.口座番号)
    expect(lastRequest.body).not.toHaveProperty('更新日時')
  })

  it('[CUA-19] 事前検証の不合格は例外にせず、欠けた配列は空にする', async () => {
    const rejected = { valid: false, errors: ['口座番号は既に登録されています'], warnings: ['注意'] }
    recordWrite('post', '/masters/customers/validate', rejected)
    await expect(validateCustomer(fullForm)).resolves.toEqual({
      valid: false,
      errors: rejected.errors,
      warnings: rejected.warnings,
    })

    recordWrite('post', '/masters/customers/validate', { valid: true })
    await expect(validateCustomer(fullForm)).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  it('[CUA-20] 登録は同じ形の本文で送り、201 の account を変換して返す', async () => {
    const SERVER_ID = 9999
    recordWrite(
      'post',
      '/masters/customers',
      { success: true, account: { ...customerItem, ID: SERVER_ID }, message: '登録しました' },
      201,
    )

    const created = await createCustomer(fullForm)

    expect(lastRequest.url.pathname).toBe('/api/masters/customers')
    expect(lastRequest.body).toEqual(createBodyOf(customerItem))
    expect(created).toMatchObject({
      id: String(SERVER_ID),
      accountNumber: String(customerItem.口座番号),
      customerName: customerItem.顧客名,
    })
  })

  it('[CUA-21] 更新は口座番号を送らず、空欄は null で明示する', async () => {
    const NEW_NAME = '更新 太郎'
    recordWrite('put', '/masters/customers/:id', {
      success: true,
      account: { ...customerItem, 顧客名: NEW_NAME },
      message: '更新しました',
    })

    const updated = await updateCustomer({
      ...withBlankOptionals(fullForm),
      id: String(customerItem.ID),
    })

    expect(lastRequest.url.pathname).toBe(`/api/masters/customers/${customerItem.ID}`)
    // 業務キーは変更不可（CustomerUpdateRequest に無い）
    expect(lastRequest.body).not.toHaveProperty('口座番号')

    const blankApiKeys = OPTIONAL_KEYS.map(apiKeyOf)
    for (const [, apiKey] of FIELD_MAP.filter(([key]) => key !== 'accountNumber')) {
      // 部分更新なので、省くと「変えない」になる。全項目のキーを残す
      expect(lastRequest.body, apiKey).toHaveProperty(apiKey)
      expect(lastRequest.body[apiKey], apiKey).toBe(
        blankApiKeys.includes(apiKey) ? null : customerItem[apiKey],
      )
    }
    expect(updated).toMatchObject({ id: String(customerItem.ID), customerName: NEW_NAME })
  })

  it('[CUA-22] 更新日時は合札があるときだけ送る', async () => {
    const UPDATED_AT = '2026-09-03T14:20:00'
    const input = { ...fullForm, id: String(customerItem.ID) }

    recordWrite('put', '/masters/customers/:id', { success: true, account: customerItem })
    await updateCustomer({ ...input, updatedAt: UPDATED_AT })
    expect(lastRequest.body.更新日時).toBe(UPDATED_AT)

    recordWrite('put', '/masters/customers/:id', { success: true, account: customerItem })
    await updateCustomer({ ...input, updatedAt: '' })
    expect(lastRequest.body).not.toHaveProperty('更新日時')
  })

  it('[CUA-23] 更新の競合(409)は detail を持つ例外になる', async () => {
    const detail = '他のユーザーによって口座情報が更新されています。'
    recordWrite('put', '/masters/customers/:id', { detail }, 409)

    await expect(updateCustomer({ ...fullForm, id: String(customerItem.ID) })).rejects.toThrow(
      detail,
    )
  })

  it('[CUA-24] 数値にならない入力は空欄と同じに扱う', async () => {
    const broken = { ...fullForm, totalAssets: '1.5', growthQuota: 'abc', cashUsd: 'abc' }
    const brokenApiKeys = ['totalAssets', 'growthQuota', 'cashUsd'].map(apiKeyOf)

    recordWrite('post', '/masters/customers', { success: true, account: customerItem }, 201)
    await createCustomer(broken)
    for (const apiKey of brokenApiKeys) {
      expect(lastRequest.body, apiKey).not.toHaveProperty(apiKey)
    }

    recordWrite('put', '/masters/customers/:id', { success: true, account: customerItem })
    await updateCustomer({ ...broken, id: String(customerItem.ID) })
    for (const apiKey of brokenApiKeys) {
      expect(lastRequest.body[apiKey], apiKey).toBeNull()
    }
  })

  it('[CUA-25] 一覧の行は編集フォームの初期値と合札も運ぶ', async () => {
    const UPDATED_AT = '2026-09-03T14:20:00'
    const { VWAP書類受入: _vwap, NISA買付可能額_翌年: _next, ...partial } = customerItem
    record(
      listBody([
        { ...customerItem, 口座番号: 1, 更新日時: UPDATED_AT },
        { ...partial, 口座番号: 2, 更新日時: null },
      ]),
    )

    const { items } = await fetchCustomers()

    expect(items[0]).toMatchObject({
      vwapDocument: customerItem.VWAP書類受入,
      specificAccountType: customerItem.特定口座区分,
      suspendEquityTrade: customerItem.取引停止区分_エクイティ商品取引_売買,
      totalAssets: customerItem.総預り資産,
      growthQuotaNext: customerItem.NISA買付可能額_翌年,
      birthDate: customerItem.生年月日,
      updatedAt: UPDATED_AT,
    })
    // 欠けた項目は文字列なら ''、数値なら null。合札の null は ''
    expect(items[1]).toMatchObject({ vwapDocument: '', growthQuotaNext: null, updatedAt: '' })
  })

  it('[CUA-26] 1 件の取得は行 ID をパスに載せ、account を一覧と同じ形に変換する', async () => {
    server.use(
      http.get('*/api/masters/customers/:id', ({ request }) => {
        const url = new URL(request.url)
        lastRequest = { url, params: url.searchParams }
        return HttpResponse.json({ account: customerItem })
      }),
    )

    const customer = await fetchCustomer(String(customerItem.ID))

    expect(lastRequest.url.pathname).toBe(`/api/masters/customers/${customerItem.ID}`)
    expect([...lastRequest.params.keys()]).toEqual([])
    expect(customer).toMatchObject({
      id: String(customerItem.ID),
      accountNumber: String(customerItem.口座番号),
      branchCode: customerItem.部店コード,
      branchName: customerItem.部店名,
      customerName: customerItem.顧客名,
      age: customerItem.年齢,
      complianceRankName: customerItem.コンプラランク名,
    })
    expect(typeof customer.accountNumber).toBe('string')
  })

  it('[CUA-27] 1 件の取得の 404 は status 付きの ApiError になる', async () => {
    const detail = '指定された口座情報が存在しません'
    server.use(
      http.get('*/api/masters/customers/:id', () => HttpResponse.json({ detail }, { status: 404 })),
    )

    const error = await fetchCustomer(String(customerItem.ID)).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
    expect(error.message).toBe(detail)
  })
})

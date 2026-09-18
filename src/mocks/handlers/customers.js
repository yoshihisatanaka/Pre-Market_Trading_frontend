import { http, HttpResponse } from 'msw'
import { canceledCustomers, customers } from '../fixtures/customers'
import { toNonNegativeInt } from './_shared'

/**
 * 顧客マスタの行。CA と同じく読むだけなので、書き換え可能な状態にはしない
 * （そのため resetMockState() にも登録しない）。
 * 削除済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
const customerRows = [...customers, ...canceledCustomers]

/**
 * 顧客マスタの一覧が 1 ページで返す件数の既定値。
 * `/masters/customers` は limit（1〜200・既定 50）を受け取るので、
 * これはクエリが無いときに使う値。
 */
const CUSTOMERS_DEFAULT_LIMIT = 50

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
]

import { http, HttpResponse } from 'msw'
import { branchListResponse, codeMasters, handlerListResponse } from '../fixtures/codes'

export const codeHandlers = [
  /*
   * 全コードマスタ一括取得。各画面のプルダウンの選択肢はここから来る。
   * 実 API は絞り込みのクエリを持たず、常に全部返す。
   */
  http.get('*/api/codes', () => HttpResponse.json(codeMasters)),

  /** 部店マスタ。実 API も絞り込みを持たない */
  http.get('*/api/branches', () => HttpResponse.json(branchListResponse)),

  /*
   * 扱者マスタ。branch_code を付けるとその部店の扱者だけを返す。
   * 実 API の「全店参照権限が無いロールは自部店に限定」はモックでは再現しない（常に全店）。
   */
  http.get('*/api/handlers', ({ request }) => {
    const branchCode = new URL(request.url).searchParams.get('branch_code')
    const items = branchCode
      ? handlerListResponse.items.filter((item) => item.部店コード === branchCode)
      : handlerListResponse.items
    return HttpResponse.json({ items })
  }),
]

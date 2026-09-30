import { http, HttpResponse } from 'msw'
import { latestUsdFxRate } from '../fixtures/fx'
import { detailError } from './_shared'

/*
 * 為替マスタ（/masters/fx）。いまは新規注文の概算に使う直近レートだけをモックする。
 * 一覧・登録・更新（/masters/fx ほか）は画面がまだ無いのでモックしない。
 *
 * 実 API は有効なレートが無い通貨に 404（ErrorResponse）を返す。モックは USD だけを持つ。
 */
export const fxHandlers = [
  http.get('*/api/masters/fx/latest', ({ request }) => {
    const currencyCode = new URL(request.url).searchParams.get('currency_code') ?? 'USD'
    if (currencyCode !== latestUsdFxRate.通貨コード) {
      return detailError(404, `通貨コード ${currencyCode} の有効な為替レートがありません。`)
    }
    return HttpResponse.json(latestUsdFxRate)
  }),
]

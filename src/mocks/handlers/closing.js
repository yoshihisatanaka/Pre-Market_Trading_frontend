import { http, HttpResponse } from 'msw'
import { mizuhoClosingStatus } from '../fixtures/closing'

/*
 * 締め管理（/closing/*）。いまはみずほ注文締の状態照会だけに応える。
 * 締め実行・締め解除は画面が確認ダイアログまでで、まだリクエストを出さない
 * （処理を繋ぐ段で、書き換え可能な状態と resetMockState() への登録を足す）。
 */
export const closingHandlers = [
  // closing_type の既定は MIZUHO。IB 締めの照会は何も返さず、次のハンドラか実 API へ流す
  http.get('*/api/closing/status', ({ request }) => {
    const closingType = new URL(request.url).searchParams.get('closing_type') ?? 'MIZUHO'
    if (closingType !== 'MIZUHO') return

    return HttpResponse.json(mizuhoClosingStatus)
  }),
]

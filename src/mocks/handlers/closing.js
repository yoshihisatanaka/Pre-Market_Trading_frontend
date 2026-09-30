import { http, HttpResponse } from 'msw'
import { mizuhoClosingStatus } from '../fixtures/closing'
import { nowIsoTimestamp } from './_shared'

/*
 * 締め管理（/closing/*）。みずほ注文締の状態照会・締め実行・締め解除に応える。
 *
 * 締め状態は書き換え可能（締めた状態が照会と注文ファイル作成に効く）。
 * テスト間で持ち越さないよう resetClosingState() を handlers/index.js の resetMockState() に登録してある。
 *
 * 実 API（app/api/order_api.py）に合わせている点:
 *   - 締めの二重実行も解除の二重実行も拒否しない（上書きになる）
 *   - 実行者 は本文の値を記録する。省かれたら 'SYSTEM'（X-User-Code からは解決しない）
 *   - 締め状態名は 締め済 / 未締め(解除)
 * 実 API と違う点: 照会（GET）も 更新日時 / 実行者 を返す（実 API は null）。
 * 既定のフィクスチャと MZ-05 の前提（締め済の応答に履歴が載る）を崩さないため。
 */

let mizuhoState = { ...mizuhoClosingStatus }

export function resetClosingState() {
  mizuhoState = { ...mizuhoClosingStatus }
}

/** いまのみずほ注文締の状態（ClosingStatusResponse の形）。注文ファイルのモックが締め済かを見る */
export function currentMizuhoClosingStatus() {
  return mizuhoState
}

/** 締め実行・締め解除の共通処理。ClosingActionRequest の本文は省略可 */
async function changeMizuhoClosing(request, closed) {
  const body = await request.json().catch(() => null)
  mizuhoState = {
    ...mizuhoState,
    締め状態: closed ? 1 : 0,
    締め状態名: closed ? '締め済' : '未締め(解除)',
    更新日時: nowIsoTimestamp(),
    実行者: typeof body?.['実行者'] === 'string' ? body['実行者'] : 'SYSTEM',
  }
  return HttpResponse.json(mizuhoState)
}

export const closingHandlers = [
  // closing_type の既定は MIZUHO。IB 締めの照会は何も返さず、次のハンドラか実 API へ流す
  http.get('*/api/closing/status', ({ request }) => {
    const closingType = new URL(request.url).searchParams.get('closing_type') ?? 'MIZUHO'
    if (closingType !== 'MIZUHO') return

    return HttpResponse.json(mizuhoState)
  }),

  http.post('*/api/closing/mizuho', ({ request }) => changeMizuhoClosing(request, true)),

  http.post('*/api/closing/mizuho/reset', ({ request }) => changeMizuhoClosing(request, false)),
]

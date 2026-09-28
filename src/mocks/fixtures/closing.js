/*
 * みずほ注文締の締め状態。`GET /closing/status?closing_type=MIZUHO` の実 API と同じ形
 * （docs/api/openapi.json の ClosingStatusResponse。キーは日本語）。
 *
 * 既定は公開モックと同じく「受付中」で、状態変更の記録が無い（更新日時・実行者が null）。
 * 締め状態名の文言は仕様に enum が無いので仮置き（画面は 締め状態 のフラグだけを見る）。
 */

export const mizuhoClosingStatus = {
  基準日: 20260928,
  締め種別: 'MIZUHO',
  締め状態: 0,
  締め状態名: '未締め',
  更新日時: null,
  実行者: null,
}

/** 締め済み。単体テスト・E2E が server.use() / mockApi() で差し替えて使う */
export const closedMizuhoClosingStatus = {
  基準日: 20260928,
  締め種別: 'MIZUHO',
  締め状態: 1,
  締め状態名: '締め済',
  更新日時: '2026-09-28T15:10:00',
  実行者: '006',
}

import { delay, http } from 'msw'
import { orderHandlers } from './orders'
import { codeHandlers } from './codes'
import { customerHandlers, resetCustomerRows } from './customers'
import { caHandlers, resetCaRows } from './ca'
import { symbolHandlers, resetSymbolRows } from './symbols'
import { balanceAdjustmentHandlers, resetBalanceAdjustmentRows } from './balanceAdjustments'
import { marketHolidayHandlers, resetMarketHolidayRows } from './marketHolidays'
import { blackoutDateHandlers, resetBlackoutDateRows } from './blackoutDates'
import { sliceCriteriaHandlers, resetSliceCriteriaRow } from './sliceCriteria'
import { fxRateHandlers, resetFxRateRows } from './fxRates'
import { activityLogHandlers } from './activityLogs'
import { permissionHandlers, resetPermissionRows } from './permissions'
import { marketStatusHandlers } from './marketStatus'
import { announcementHandlers, resetAnnouncementState } from './announcements'
import { bannerHandlers } from './banner'
import { stalledOrderHandlers, resetStalledOrderState } from './stalledOrders'
import { incidentHandlers, resetIncidentState } from './incidents'
import { mizuhoExecutionHandlers } from './mizuhoExecutions'
import { closingHandlers } from './closing'
import { executionHandlers } from './executions'
import { dreamStatusHandlers } from './dreamStatus'
import { orderCsvHandlers } from './orderCsv'

/*
 * モックハンドラの集約。**ハンドラ本体は画面（API のまとまり）ごとのファイルに分けてある。**
 * 新しい画面のモックは新しいファイルに書き、ここへは import と配列への追加だけを足す
 * （全画面が 1 つのファイルを触って衝突するのを避けるため。2026-09-18 に分割）。
 *
 * ルール:
 *  - パスは `* + baseURL` で始める（`*` で origin の違いを吸収し、ブラウザ/Node 双方で一致させる）
 *  - バックエンドで実装された API は、そのファイルのハンドラを削除する。
 *    未定義のリクエストは実 API へ素通しされるため、削除するだけで本物に切り替わる。
 *  - 書き換え可能な状態（登録したものが一覧に出る）を持つファイルは reset 関数を export し、
 *    下の resetMockState() に登録する。テスト間で持ち越さないよう、単体テストは
 *    vitest.setup.js の afterEach で resetMockState() を呼ぶ
 *  - 共通のヘルパ（エラー応答の形・日付の検査・楽観的ロックの照合）は _shared.js
 *
 * 例外は下に並べたパス（海外休場日・受注不可日・スライス基準・市場ステータス・CSV一括注文の列仕様）。
 * 実 API は実装済みだが、単体テストと E2E がこの handlers を共用しているのでハンドラは残し、
 * **実 API と同じ形**に寄せてある。
 *   /masters/market-holidays … 日本語キー / integer の日付 / 降順 / エラーは { detail } / 論理削除
 *   /masters/blackout-dates  … 同上
 *   /masters/hard-limits     … 日本語キー / 拒否は 422 の HTTPValidationError と 409 の ErrorResponse
 *   /masters/fx              … 日本語キー / integer の基準日 / 最新・詳細・事前検証・登録・変更だけ
 *   /market-status           … 日本語キー / 空白入りキー / 日付を「今日」へずらして返す
 *   /orders/csv-spec         … CSV一括注文の全 22 列の仕様（CsvHeaderSpecResponse そのまま）
 * マスタ系のパスは 2026-09-15 の OpenAPI 取り込みで /masters/ 配下へ移った。
 * 実 API に当てて動かすときは環境変数 VITE_ENABLE_MSW を false にする（README「バックエンドとの連携」）。
 */

/**
 * ローディング表示を目で確かめるための遅延（ブラウザでの開発時だけのつまみ）。
 *
 * モックは即座に応答するので、そのままでは 4 状態のうちローディングだけが一瞬すぎて見えない。
 * URL に `?mockDelay=3000` を付けると、その URL の API 応答が 3 秒遅れる。
 *
 * 効くのは**クエリが付いている間だけ**で、記憶はしない。外せば即座に遅延なしに戻る。
 * 画面遷移でクエリが落ちればそこで終わるので、遷移先でも遅らせたいならその URL にも付ける。
 *
 * 単体テストと E2E は付けないので常に 0 になり、実行時間には影響しない。
 */
const MOCK_DELAY_KEY = 'mockDelay'

function mockDelayMs() {
  // 単体テストの jsdom にも window はあるが、クエリが空なので 0 になる
  if (typeof window === 'undefined') return 0

  // クエリ無しなら get() は null → Number(null) は 0。不正な値も || 0 で 0 に落ちる
  return Number(new URLSearchParams(window.location.search).get(MOCK_DELAY_KEY)) || 0
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetMockState() {
  resetCustomerRows()
  resetMarketHolidayRows()
  resetBlackoutDateRows()
  resetCaRows()
  resetSymbolRows()
  resetBalanceAdjustmentRows()
  resetSliceCriteriaRow()
  resetFxRateRows()
  resetPermissionRows()
  resetAnnouncementState()
  resetStalledOrderState()
  resetIncidentState()
}

export const handlers = [
  /*
   * 遅延だけを担う先頭のハンドラ。応答を返さない（undefined）ので、
   * 待ったあとは次に一致するハンドラがそのまま応答する。
   */
  http.all('*/api/*', async () => {
    const ms = mockDelayMs()
    if (ms > 0) await delay(ms)
  }),

  ...orderHandlers,
  ...codeHandlers,
  ...customerHandlers,
  ...caHandlers,
  ...symbolHandlers,
  ...balanceAdjustmentHandlers,
  ...marketHolidayHandlers,
  ...blackoutDateHandlers,
  ...sliceCriteriaHandlers,
  ...fxRateHandlers,
  ...activityLogHandlers,
  ...permissionHandlers,
  ...marketStatusHandlers,
  ...announcementHandlers,
  ...bannerHandlers,
  ...stalledOrderHandlers,
  ...incidentHandlers,
  // みずほ（route=0）の問い合わせだけを先に拾い、それ以外は約定照会のモックへ流す
  ...mizuhoExecutionHandlers,
  ...closingHandlers,
  ...executionHandlers,
  ...dreamStatusHandlers,
  ...orderCsvHandlers,
]

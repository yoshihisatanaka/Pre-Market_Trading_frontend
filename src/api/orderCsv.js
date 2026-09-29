import { apiClient } from './client'

/*
 * CSV一括注文（`/orders/csv-spec` ほか）。
 *
 * IFA 向けに、注文を CSV ファイルでまとめて受け付ける。流れは
 *   テンプレートDL → CSV を選んで事前検証（プレビュー）→ 全行が正常なら一括受付
 * の 3 段で、API もこの順に `GET /orders/csv-template` → `POST /orders/validate-csv` →
 * `POST /orders/bulk-create` がある（どれも openapi.json に在る）。
 *
 * いま繋いでいるのは、取込み画面の「CSVフォーマット」表を埋める `GET /orders/csv-spec` だけ。
 * 列の定義（全 22 列の列名・必須・説明・例）はバックエンドが持っていて、画面は写しを持たない。
 *
 * TODO(処理実装): 残りの 3 本（取込み画面は UI だけ先に置いてある。プレビュー・受付完了の画面は
 *   処理を足すときに作る）。
 *   - テンプレートDL `GET /orders/csv-template`（text/csv。UTF-8 BOM 付き・サンプル 3 行）
 *   - 事前検証 `POST /orders/validate-csv`（multipart の file）。応答は CsvOrderValidateResponse
 *   - 一括受付 `POST /orders/bulk-create`（`{ orders: OrderRequest[] }`）
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - snake_case（total_columns / allowed_values）
 *   - 例（example）の型が列ごとに違う（'A0001' / 1000113 / 150.0）。アプリ内は文字列に揃える
 *   - 条件付きの必須（condition）は無ければ null。アプリ内は空文字
 */

/**
 * CSV の 1 列ぶんの仕様。
 *
 * @typedef {{
 *   index: number, name: string, required: boolean,
 *   description: string, example: string, condition: string,
 * }} OrderCsvColumn
 *   name は CSV のヘッダー行に書く列名そのもの（「部店」「口座番号」…）。
 *   condition は「指成区分がLO（指値）の場合は必須」のような、ほかの列の値で決まる必須。
 */

/**
 * CSV一括注文のヘッダー仕様（全列）を取得する。
 *
 * @returns {Promise<OrderCsvColumn[]>} CSV の列の並び（index の昇順）
 */
export async function fetchOrderCsvSpec() {
  const { data } = await apiClient.get('/orders/csv-spec')
  return (data?.columns ?? []).map(toOrderCsvColumn).sort((a, b) => a.index - b.index)
}

function toOrderCsvColumn(raw) {
  return {
    index: raw?.index ?? 0,
    name: raw?.name ?? '',
    // 必須は true のときだけ必須にする。欠けた値を必須に倒すと、表の赤字が実際の検証とずれる
    required: raw?.required === true,
    description: raw?.description ?? '',
    // 例は列の型のまま来る。表に出すだけなので文字列に寄せる（null / undefined は空）
    example: raw?.example == null ? '' : String(raw.example),
    condition: raw?.condition ?? '',
  }
}

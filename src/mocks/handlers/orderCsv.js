import { http, HttpResponse } from 'msw'
import { orderCsvSpecResponse } from '../fixtures/orderCsv'

/*
 * CSV一括注文（`/orders/csv/upload`）。
 *
 * `GET /orders/csv-spec` は実 API が実装済みだが、単体テストと E2E がこの handlers を共用するので
 * 残す（index.js の冒頭コメントの例外）。形は実 API と同じ CsvHeaderSpecResponse。
 *
 * TODO(処理実装): テンプレートDL・事前検証・一括受付（csv-template / validate-csv / bulk-create）の
 *   ハンドラは、src/api/orderCsv.js に関数を足すときに一緒に足す。
 */
export const orderCsvHandlers = [
  http.get('*/api/orders/csv-spec', () => HttpResponse.json(orderCsvSpecResponse)),
]

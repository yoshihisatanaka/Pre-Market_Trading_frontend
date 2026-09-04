import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'

/*
 * モックハンドラの集約。
 *
 * ルール:
 *  - パスは `* + baseURL` で始める（`*` で origin の違いを吸収し、ブラウザ/Node 双方で一致させる）
 *  - バックエンドで実装された API は、このリストから削除する。
 *    未定義のリクエストは実 API へ素通しされるため、削除するだけで本物に切り替わる。
 */
export const handlers = [http.get('*/api/orders', () => HttpResponse.json(orderListResponse))]

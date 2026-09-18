import { http, HttpResponse } from 'msw'
import { orderListResponse } from '../fixtures/orders'

/** 注文一覧（`/`）。縦串の参考実装用で、実仕様が来たら差し替える */
export const orderHandlers = [http.get('*/api/orders', () => HttpResponse.json(orderListResponse))]

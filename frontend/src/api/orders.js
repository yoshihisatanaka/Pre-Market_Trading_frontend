import { apiClient } from './client'

/**
 * 注文一覧を取得する。
 * バックエンドのレスポンス形（snake_case 等）を知ってよいのはこの api 層だけ。
 * 実 API の仕様が確定したら toOrder() の変換だけを直せば呼び出し側は無変更で済む。
 *
 * @returns {Promise<Array<{
 *   id: string, symbol: string, name: string, side: 'buy'|'sell',
 *   quantity: number, price: number, status: string, orderedAt: string
 * }>>}
 */
export async function fetchOrders() {
  const { data } = await apiClient.get('/orders')
  return (data.items ?? []).map(toOrder)
}

function toOrder(raw) {
  return {
    id: raw.id,
    symbol: raw.symbol,
    name: raw.name,
    side: raw.side,
    quantity: raw.quantity,
    price: raw.price,
    status: raw.status,
    orderedAt: raw.ordered_at,
  }
}

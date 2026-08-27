/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * OpenAPI が確定したら、その example をこのファイルに反映する。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */
export const orderListResponse = {
  items: [
    {
      id: 'ord_0001',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      side: 'buy',
      quantity: 10,
      price: 227.52,
      status: 'filled',
      ordered_at: '2026-08-25T14:32:00Z',
    },
    {
      id: 'ord_0002',
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      side: 'buy',
      quantity: 5,
      price: 418.1,
      status: 'working',
      ordered_at: '2026-08-26T09:05:00Z',
    },
    {
      id: 'ord_0003',
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      side: 'sell',
      quantity: 20,
      price: 133.86,
      status: 'canceled',
      ordered_at: '2026-08-26T18:47:00Z',
    },
  ],
  total: 3,
}

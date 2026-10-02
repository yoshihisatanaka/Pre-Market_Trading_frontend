/*
 * 注文照会（実 API `GET /orders`）のモックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」（`OrderItemResponse`）であり、アプリ内モデルではない。
 *
 * 同じパスの縦串の参考実装（fixtures/orders.js の orderListResponse）とは別物。
 * ハンドラ（handlers/orders.js）が 1 つの応答に両方を載せて返す。
 *
 * 画面モックの見どころをひととおり出せるように並べてある:
 *   - 訂正 1 回（#38 → #42）と訂正 2 回（#30 → #33 → #36）。`元注文ID` は起点を指す
 *   - スライス基準による自動分割（親 #35 と子注文 #43〜#45。`注文種別` が 'SLICE_CHILD'）
 *   - 出来状況は 未出来 / 注文中 / 一部出来 / 全部出来 / 取消済 / 取消済（出来有）/ 注文エラー
 *   - VWAP 注文（`VWAP区分` 1）
 *
 * コード値:
 *   売買区分 … '1' 売 / '3' 買（`GET /orders` の side クエリの説明による）
 *   指成区分 … 'LO' 指値 / 'MO' 成行
 *   処理状況 … '000' 未発注 / '003' 注文中 / '010' 一部出来 / '011' 全部出来 / '034' 取消済 / '101' 発注失敗
 *   発注範囲 … '01'〜'06'（ExecutionScopeEnum。名前との対応は仕様に無いので値だけ置く）
 *
 * 約定代金_JPY は 約定代金 × 適用為替レート（150）を円未満で四捨五入した概算。
 * 並びはサーバの既定（注文 ID の降順）に合わせてある。
 */

/** 円貨概算に使う為替レート（応答の `適用為替レート`） */
export const orderInquiryFxRate = 150

/*
 * 注文の顧客。yamada だけは顧客マスタ（fixtures/customers.js）の口座 1230001 と同じにしてある
 * （顧客詳細の注文照会タブ /customers/1/orders で、その顧客の注文が出るように）。
 * ほかの 3 人は顧客マスタに居ない口座のまま。
 */
const CUSTOMERS = {
  yamada: { 部店: '123', 部店名: 'A支店', 口座番号: 1230001, 顧客名: '山田 太郎' },
  kato: { 部店: '234', 部店名: '大阪支店', 口座番号: 200001, 顧客名: '加藤 誠' },
  tanaka: { 部店: '345', 部店名: '名古屋支店', 口座番号: 300002, 顧客名: '田中 正雄' },
  kimura: { 部店: '345', 部店名: '名古屋支店', 口座番号: 300003, 顧客名: '木村 浩二' },
}

const STATUS_NAMES = {
  '000': '未発注',
  '003': '注文中',
  '010': '一部出来',
  '011': '全部出来',
  '034': '取消済',
  101: '発注失敗',
}

/**
 * 1 行ぶんの OrderItemResponse を組み立てる。
 * 行ごとに違うのは注文の中身と状態だけなので、画面が読まない nullable 項目は既定値に寄せる。
 */
function order({
  id,
  originalOrderId = null,
  kind = null,
  customer,
  symbol,
  name,
  side,
  quantity,
  orderType,
  limitPrice = null,
  scope = '01',
  vwap = 0,
  date = '2026-09-28',
  time,
  status,
  displayStatus,
  filled = 0,
  canceled = null,
  amountUsd = null,
  error = null,
}) {
  const terminal = ['011', '034', '101'].includes(status)
  return {
    ID: id,
    元注文ID: originalOrderId,
    注文種別: kind,
    ...customer,
    銘柄コード: symbol,
    Ticker: symbol,
    銘柄名: name,
    売買区分: side,
    売買区分名: side === '1' ? '売' : '買',
    数量: quantity,
    指成区分: orderType,
    指値単価: limitPrice,
    発注範囲: scope,
    VWAP区分: vwap,
    注文ルート: vwap === 1 ? '2' : '1',
    注文ルート名: vwap === 1 ? 'VWAP' : 'IB',
    受注日: date,
    受注時刻: time,
    処理状況: status,
    処理状況名: STATUS_NAMES[status],
    表示状況名: displayStatus,
    出来数量: filled,
    取消数量: canceled,
    有効残数量: terminal ? 0 : quantity - filled,
    出来有無: filled > 0,
    集計対象: !['034', '101'].includes(status) && kind !== 'SLICE_CHILD',
    約定代金: amountUsd,
    約定代金_JPY: amountUsd === null ? null : Math.round(amountUsd * orderInquiryFxRate),
    エラー内容: error,
  }
}

export const orderInquiryRows = [
  order({
    id: 45,
    originalOrderId: 35,
    kind: 'SLICE_CHILD',
    customer: CUSTOMERS.tanaka,
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    side: '3',
    quantity: 1000,
    orderType: 'MO',
    scope: '04',
    time: '09:02:00',
    status: '000',
    displayStatus: '未出来',
  }),
  order({
    id: 44,
    originalOrderId: 35,
    kind: 'SLICE_CHILD',
    customer: CUSTOMERS.tanaka,
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    side: '3',
    quantity: 1000,
    orderType: 'MO',
    scope: '04',
    time: '09:02:00',
    status: '010',
    displayStatus: '一部出来',
    filled: 200,
    amountUsd: 67_750,
  }),
  order({
    id: 43,
    originalOrderId: 35,
    kind: 'SLICE_CHILD',
    customer: CUSTOMERS.tanaka,
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    side: '3',
    quantity: 1000,
    orderType: 'MO',
    scope: '04',
    time: '09:02:00',
    status: '011',
    displayStatus: '全部出来',
    filled: 1000,
    amountUsd: 338_500,
  }),
  order({
    id: 42,
    originalOrderId: 38,
    customer: CUSTOMERS.yamada,
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    side: '3',
    quantity: 80,
    orderType: 'LO',
    limitPrice: 415,
    time: '10:05:00',
    status: '003',
    displayStatus: '注文中',
  }),
  order({
    id: 41,
    customer: CUSTOMERS.yamada,
    symbol: 'AAPL',
    name: 'Apple Inc.',
    side: '3',
    quantity: 100,
    orderType: 'LO',
    limitPrice: 228.5,
    time: '09:58:00',
    status: '011',
    displayStatus: '全部出来',
    filled: 100,
    amountUsd: 22_850,
  }),
  order({
    id: 40,
    customer: CUSTOMERS.kimura,
    symbol: 'AMZN',
    name: 'Amazon.com, Inc.',
    side: '1',
    quantity: 40,
    orderType: 'LO',
    limitPrice: 214.25,
    time: '09:45:00',
    status: '101',
    displayStatus: '注文エラー',
    error: '注文送信処理がタイムアウトしました。',
  }),
  order({
    id: 39,
    customer: CUSTOMERS.kato,
    symbol: 'GOOGL',
    name: 'Alphabet Inc. Class A',
    side: '3',
    quantity: 60,
    orderType: 'LO',
    limitPrice: 165,
    scope: '02',
    time: '09:40:00',
    status: '034',
    displayStatus: '取消済（出来有）',
    filled: 20,
    canceled: 40,
    amountUsd: 3_300,
  }),
  order({
    id: 38,
    customer: CUSTOMERS.yamada,
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    side: '3',
    quantity: 50,
    orderType: 'LO',
    limitPrice: 410,
    time: '09:35:00',
    status: '034',
    displayStatus: '取消済',
    canceled: 50,
  }),
  order({
    id: 37,
    customer: CUSTOMERS.kato,
    symbol: 'META',
    name: 'Meta Platforms, Inc.',
    side: '1',
    quantity: 10,
    orderType: 'MO',
    scope: '03',
    time: '09:30:00',
    status: '034',
    displayStatus: '取消済',
    canceled: 10,
  }),
  order({
    id: 36,
    originalOrderId: 30,
    customer: CUSTOMERS.tanaka,
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    side: '1',
    quantity: 25,
    orderType: 'LO',
    limitPrice: 143.5,
    time: '09:25:00',
    status: '000',
    displayStatus: '未出来',
  }),
  order({
    id: 35,
    customer: CUSTOMERS.tanaka,
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    side: '3',
    quantity: 3000,
    orderType: 'MO',
    scope: '04',
    time: '09:01:00',
    status: '010',
    displayStatus: '一部出来',
    filled: 1200,
    amountUsd: 406_250,
  }),
  order({
    id: 34,
    customer: CUSTOMERS.kimura,
    symbol: 'AAPL',
    name: 'Apple Inc.',
    side: '3',
    quantity: 500,
    orderType: 'MO',
    scope: '02',
    vwap: 1,
    time: '08:55:00',
    status: '003',
    displayStatus: '注文中',
  }),
  order({
    id: 33,
    originalOrderId: 30,
    customer: CUSTOMERS.tanaka,
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    side: '1',
    quantity: 25,
    orderType: 'LO',
    limitPrice: 142,
    time: '08:50:00',
    status: '034',
    displayStatus: '取消済',
    canceled: 25,
  }),
  order({
    id: 30,
    customer: CUSTOMERS.tanaka,
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    side: '1',
    quantity: 30,
    orderType: 'LO',
    limitPrice: 140,
    date: '2026-09-25',
    time: '15:10:00',
    status: '034',
    displayStatus: '取消済',
    canceled: 30,
  }),
]

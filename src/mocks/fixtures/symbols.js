/*
 * モックのレスポンス実体（銘柄マスタ）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の SymbolItem に合わせてある
 * （プロパティ名は日本語、Pre区分・取消区分・ユーザー操作フラグは 0/1 の integer）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 規制情報名 / 注文ルート名 / VWAP対象区分名 は DB の列ではなく、バックエンドが応答を
 * 組み立てるときにコードマスタから付ける表示項目。生の応答には載るのでここでも持つ。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 画面モックに出ている 12 件（S001〜S012。数値もモックの値）に、
 * 44 件を機械生成して足して 56 件にしてある。混ぜてあるもの:
 *   - 規制情報=1（取引不可）と VWAP対象区分=0（対象外）の行
 *   - 注文ルートは 0（みずほ）/ 1（IB）の両方
 *   - ユーザー操作フラグ=1（手動操作された行。一覧で色が付く）を 18 件
 *   - 前日終値・前日出来高・平均出来高が null の行を 2 件（'—' 表示の確認用。
 *     1 ページ目の S021 と 2 ページ目の S055）
 */

/** コード → 表示名。src/utils/symbolTypes.js と同じ対応表（規制情報は仮置きの値） */
const REGULATION_NAMES = { 0: '取引可', 1: '取引不可' }
const ORDER_ROUTE_NAMES = { 0: 'みずほ証券', 1: 'IB証券' }
const VWAP_TARGET_NAMES = { 0: '対象外', 1: '対象' }

/**
 * 画面モック（/masters/symbols）に出ている 12 件。
 * 平均出来高・前日終値はモックの表示値そのまま。前日出来高はモックに列が無いので、
 * 平均出来高から外れた値（多い日・少ない日）を持たせてある。
 */
const FEATURED = [
  {
    ticker: 'AAPL',
    nameEn: 'Apple Inc.',
    name: 'アップル',
    market: 'NASDAQ',
    averageVolume: 50_000_000,
    previousVolume: 43_820_000,
    previousClose: 227.16,
  },
  {
    ticker: 'MSFT',
    nameEn: 'Microsoft Corp.',
    name: 'マイクロソフト',
    market: 'NASDAQ',
    averageVolume: 25_000_000,
    previousVolume: 31_450_000,
    previousClose: 419.8,
    orderRoute: '0',
    userModified: true,
  },
  {
    ticker: 'GOOGL',
    nameEn: 'Alphabet Inc.',
    name: 'アルファベット',
    market: 'NASDAQ',
    averageVolume: 22_000_000,
    previousVolume: 19_870_000,
    previousClose: 189.12,
  },
  {
    ticker: 'AMZN',
    nameEn: 'Amazon.com Inc.',
    name: 'アマゾン',
    market: 'NASDAQ',
    averageVolume: 35_000_000,
    previousVolume: 38_210_000,
    previousClose: 226.8,
    orderRoute: '0',
  },
  {
    ticker: 'NVDA',
    nameEn: 'NVIDIA Corp.',
    name: 'エヌビディア',
    market: 'NASDAQ',
    averageVolume: 180_000_000,
    previousVolume: 245_600_000,
    previousClose: 127.25,
  },
  {
    ticker: 'TSLA',
    nameEn: 'Tesla Inc.',
    name: 'テスラ',
    market: 'NASDAQ',
    averageVolume: 85_000_000,
    previousVolume: 112_300_000,
    previousClose: 248.98,
    vwapTarget: '0',
    note: 'ボラティリティ高め',
    userModified: true,
  },
  {
    ticker: 'META',
    nameEn: 'Meta Platforms Inc.',
    name: 'メタ',
    market: 'NASDAQ',
    averageVolume: 18_000_000,
    previousVolume: 15_640_000,
    previousClose: 519.1,
    orderRoute: '0',
  },
  {
    ticker: 'JPM',
    nameEn: 'JPMorgan Chase & Co.',
    name: 'JPモルガン',
    market: 'NYSE',
    averageVolume: 12_000_000,
    previousVolume: 10_780_000,
    previousClose: 228.34,
    vwapTarget: '0',
  },
  {
    ticker: 'V',
    nameEn: 'Visa Inc.',
    name: 'ビザ',
    market: 'NYSE',
    averageVolume: 8_000_000,
    previousVolume: 7_120_000,
    previousClose: 272.66,
    orderRoute: '0',
  },
  {
    ticker: 'BRK.B',
    nameEn: 'Berkshire Hathaway Inc.',
    name: 'バークシャー・ハサウェイ',
    market: 'NYSE',
    averageVolume: 3_500_000,
    previousVolume: 2_980_000,
    previousClose: 442.15,
    regulation: '1',
    vwapTarget: '0',
    preFlag: 0,
    note: '一時取引停止中',
    userModified: true,
  },
  {
    ticker: 'NFLX',
    nameEn: 'Netflix Inc.',
    name: 'ネットフリックス',
    market: 'NASDAQ',
    averageVolume: 5_500_000,
    previousVolume: 6_340_000,
    previousClose: 690.54,
    orderRoute: '0',
  },
  {
    ticker: 'DIS',
    nameEn: 'The Walt Disney Co.',
    name: 'ウォルト・ディズニー',
    market: 'NYSE',
    averageVolume: 9_000_000,
    previousVolume: 8_150_000,
    previousClose: 111.35,
    vwapTarget: '0',
  },
]

/** 機械生成ぶんの銘柄名。[Ticker, 銘柄名_英字, 銘柄名] */
const FILLER_NAMES = [
  ['ORCL', 'Oracle Corp.', 'オラクル'],
  ['CRM', 'Salesforce Inc.', 'セールスフォース'],
  ['ADBE', 'Adobe Inc.', 'アドビ'],
  ['AMD', 'Advanced Micro Devices Inc.', 'AMD'],
  ['INTC', 'Intel Corp.', 'インテル'],
  ['CSCO', 'Cisco Systems Inc.', 'シスコシステムズ'],
  ['QCOM', 'Qualcomm Inc.', 'クアルコム'],
  ['TXN', 'Texas Instruments Inc.', 'テキサス・インスツルメンツ'],
  ['AVGO', 'Broadcom Inc.', 'ブロードコム'],
  ['MU', 'Micron Technology Inc.', 'マイクロン・テクノロジー'],
  ['AMAT', 'Applied Materials Inc.', 'アプライド・マテリアルズ'],
  ['NOW', 'ServiceNow Inc.', 'サービスナウ'],
  ['INTU', 'Intuit Inc.', 'インテュイット'],
  ['IBM', 'International Business Machines Corp.', 'IBM'],
  ['ACN', 'Accenture plc', 'アクセンチュア'],
  ['UBER', 'Uber Technologies Inc.', 'ウーバー'],
  ['ABNB', 'Airbnb Inc.', 'エアビーアンドビー'],
  ['PYPL', 'PayPal Holdings Inc.', 'ペイパル'],
  ['SQ', 'Block Inc.', 'ブロック'],
  ['SHOP', 'Shopify Inc.', 'ショッピファイ'],
  ['SPOT', 'Spotify Technology S.A.', 'スポティファイ'],
  ['SNAP', 'Snap Inc.', 'スナップ'],
  ['PINS', 'Pinterest Inc.', 'ピンタレスト'],
  ['ZM', 'Zoom Communications Inc.', 'ズーム'],
  ['DOCU', 'DocuSign Inc.', 'ドキュサイン'],
  ['CRWD', 'CrowdStrike Holdings Inc.', 'クラウドストライク'],
  ['PANW', 'Palo Alto Networks Inc.', 'パロアルトネットワークス'],
  ['SNOW', 'Snowflake Inc.', 'スノーフレイク'],
  ['DDOG', 'Datadog Inc.', 'データドッグ'],
  ['NET', 'Cloudflare Inc.', 'クラウドフレア'],
  ['MDB', 'MongoDB Inc.', 'モンゴDB'],
  ['OKTA', 'Okta Inc.', 'オクタ'],
  ['TWLO', 'Twilio Inc.', 'トゥイリオ'],
  ['ROKU', 'Roku Inc.', 'ロク'],
  ['TTD', 'The Trade Desk Inc.', 'トレードデスク'],
  ['COIN', 'Coinbase Global Inc.', 'コインベース'],
  ['HOOD', 'Robinhood Markets Inc.', 'ロビンフッド'],
  ['SOFI', 'SoFi Technologies Inc.', 'ソーファイ'],
  ['PLTR', 'Palantir Technologies Inc.', 'パランティア'],
  ['RBLX', 'Roblox Corp.', 'ロブロックス'],
  ['U', 'Unity Software Inc.', 'ユニティ'],
  ['DASH', 'DoorDash Inc.', 'ドアダッシュ'],
  ['LYFT', 'Lyft Inc.', 'リフト'],
  ['RIVN', 'Rivian Automotive Inc.', 'リビアン'],
]

/** 前日出来高を平均出来高からずらす倍率（多い日・少ない日を作る） */
const VOLUME_FACTORS = [0.62, 0.88, 1.04, 1.35, 1.81]

/** 相場の数値が未取得の行（'—' 表示の確認用）。1 ページ目と 2 ページ目に 1 件ずつ */
const WITHOUT_QUOTE = new Set(['S021', 'S055'])

/** 'S001' の形。銘柄コードは実 API では varchar(14) だが、モックは画面モックの体裁に合わせる */
function toSymbolCode(serial) {
  return `S${String(serial).padStart(3, '0')}`
}

function toSymbolItem({
  serial,
  ticker,
  nameEn,
  name,
  market,
  regulation = '0',
  orderRoute = '1',
  vwapTarget = '1',
  preFlag = 1,
  note = '',
  previousClose,
  previousVolume,
  averageVolume,
  userModified = false,
  canceled = false,
}) {
  const symbolCode = toSymbolCode(serial)
  const hasQuote = !WITHOUT_QUOTE.has(symbolCode)

  return {
    銘柄コード: symbolCode,
    Ticker: ticker,
    銘柄名: name,
    銘柄名_英字: nameEn,
    市場名: market,
    規制情報: regulation,
    規制情報名: REGULATION_NAMES[regulation] ?? null,
    注文ルート: orderRoute,
    注文ルート名: ORDER_ROUTE_NAMES[orderRoute] ?? null,
    VWAP対象区分: vwapTarget,
    VWAP対象区分名: VWAP_TARGET_NAMES[vwapTarget] ?? null,
    Pre区分: preFlag,
    備考: note,
    // 未取得は null。実 API も取得前・取得失敗を null で返す
    前日終値: hasQuote ? previousClose : null,
    前日出来高: hasQuote ? previousVolume : null,
    平均出来高: hasQuote ? averageVolume : null,
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: userModified ? 1 : 0,
    作成日時: '2026-08-10T10:00:00',
    作成者: 'SYSTEM',
    更新日時: userModified ? '2026-08-20T09:30:00' : null,
    更新者: userModified ? '702' : null,
    取消日時: canceled ? '2026-08-25T11:00:00' : null,
    取消者: canceled ? '702' : null,
  }
}

/**
 * 有効な行（取消区分 0）。56 件。
 * 並べ替えは読み出し側（ハンドラ）が実 API と同じ規則で行うので、ここでは生成順のまま置く。
 */
export const symbols = [
  ...FEATURED.map((symbol, index) => toSymbolItem({ serial: index + 1, ...symbol })),
  ...FILLER_NAMES.map(([ticker, nameEn, name], index) => {
    const averageVolume = ((index % 7) + 1) * 1_250_000

    return toSymbolItem({
      serial: FEATURED.length + index + 1,
      ticker,
      nameEn,
      name,
      market: index % 3 === 2 ? 'NYSE' : 'NASDAQ',
      // 取引不可を数件だけ混ぜる
      regulation: index % 11 === 5 ? '1' : '0',
      orderRoute: index % 2 === 0 ? '1' : '0',
      vwapTarget: index % 4 === 1 ? '0' : '1',
      preFlag: index % 5 === 0 ? 0 : 1,
      note: index % 9 === 4 ? '要観察' : '',
      previousClose: Math.round((40 + index * 7.25) * 100) / 100,
      previousVolume: Math.round(averageVolume * VOLUME_FACTORS[index % 5]),
      averageVolume,
      userModified: index % 3 === 0,
    })
  }),
]

/**
 * 取消済み（論理削除）の行。既定の一覧には出ない。
 * `include_deleted=true` を送ったときだけ返るので、「取消区分で外している」ことを確かめられる。
 */
export const canceledSymbols = [
  toSymbolItem({
    serial: symbols.length + 1,
    ticker: 'DLST',
    nameEn: 'Delisted Sample Corp.',
    name: '上場廃止サンプル',
    market: 'NASDAQ',
    regulation: '1',
    vwapTarget: '0',
    preFlag: 0,
    note: '上場廃止のため削除',
    previousClose: 12.4,
    previousVolume: 180_000,
    averageVolume: 250_000,
    canceled: true,
  }),
]

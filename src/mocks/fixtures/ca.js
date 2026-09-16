/*
 * モックのレスポンス実体（CAマスタ）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の CAItem と、バックエンドの m_ca に合わせてある
 * （プロパティ名は日本語、日付は integer の YYYYMMDD、取消区分・ユーザー操作フラグは 0/1）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 比率 と CA種別名 は DB の列ではなく、バックエンドが応答を組み立てるときに付ける表示項目
 * （比率は `分母:分子`、CA種別名は codes.json の対応表）。生の応答には載るのでここでも持つ。
 *
 * **`ステータス` は実 API 未実装の仮項目。** CAItem にこの項目は無く、コードマスタ
 * （`GET /codes` の `ステータス`）もまだ返ってこない。値は fixtures/codes.js の statusCodes
 * （'1' 予定 / '2' 確定 / '3' 完了）と同じ仮のコード。バックエンドが実装したら、ここと
 * src/api/ca.js の toCorporateAction() / toCaRequest() を実際の項目名に合わせて直す。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 銘柄 8 件 × CA 7 件 = 56 件を 2026 年分として作り、うち 16 件を
 * ユーザー操作フラグ=1（手動操作された行。一覧で色が付く）にしてある。
 */

/**
 * 銘柄。値はバックエンドの seed_data.sql（m_銘柄情報）から借りた実在の組み合わせ。
 *
 * **モックの銘柄マスタ（m_銘柄情報）の代役**でもある。実 API の `POST /masters/ca/validate` は
 * 「銘柄コードマスタ存在検証 & Ticker自動補完」を行うので、ハンドラ側がこの表を引いて
 * 未知の銘柄コードを弾き、Ticker を補完する。そのため export している。
 */
export const caStocks = [
  { stockCode: 'A0001', ticker: 'A001' },
  { stockCode: 'A0002', ticker: 'A002' },
  { stockCode: 'A0003', ticker: 'A003' },
  { stockCode: 'A0004', ticker: 'A004' },
  { stockCode: 'A0005', ticker: 'A005' },
  { stockCode: 'A0030', ticker: 'AAPL' },
  { stockCode: 'A0031', ticker: 'ORG' },
  { stockCode: 'A0032', ticker: 'BNN' },
]

/**
 * 1 銘柄あたりの CA。日付は 2026 年の月日で、支払日の無い CA（分割・併合・割当）は null。
 * userModified が付いた 2 件は「画面から手を入れた行」を表す（一覧で色が付く側）。
 *
 * status は 3 値すべてが出るように配る。この 7 件が銘柄 8 件ぶん繰り返されるので、
 * ステータスで絞り込んだときの件数は必ず 8 の倍数になる（完了 16 / 確定 24 / 予定 16）。
 */
const CA_EVENTS_PER_STOCK = [
  {
    caType: '110',
    exRights: '0315',
    effective: '0316',
    payment: '0330',
    denominator: 1,
    numerator: 0.5,
    note: 'Q1現金配当',
    status: '3',
  },
  {
    caType: '110',
    exRights: '0615',
    effective: '0616',
    payment: '0630',
    denominator: 1,
    numerator: 0.55,
    note: 'Q2現金配当',
    status: '3',
  },
  {
    caType: '110',
    exRights: '0915',
    effective: '0916',
    payment: '0930',
    denominator: 1,
    numerator: 0.55,
    note: 'Q3現金配当',
    status: '2',
    userModified: true,
  },
  {
    caType: '120',
    exRights: '0428',
    effective: '0430',
    payment: null,
    denominator: 1,
    numerator: 2,
    note: '1:2 株式分割',
    status: '2',
  },
  {
    caType: '140',
    exRights: '0520',
    effective: '0521',
    payment: null,
    denominator: 5,
    numerator: 1,
    note: '5:1 株式併合',
    status: '2',
  },
  {
    caType: '112',
    exRights: '1110',
    effective: '1111',
    payment: '1125',
    denominator: 100,
    numerator: 5,
    note: '5% 株式配当',
    status: '1',
    userModified: true,
  },
  {
    caType: '121',
    exRights: '0818',
    effective: '0820',
    payment: null,
    denominator: 10,
    numerator: 1,
    note: '10:1 無償割当',
    status: '1',
  },
]

/**
 * CA種別コード → 表示名。バックエンドの codes.json（CA種別）と同じ対応表。
 *
 * ハンドラも登録・更新した行の `CA種別名` を組むのに使うので export している
 * （`src/utils/caTypes.js` にも同じ対応表があるが、モックは「バックエンド側の応答」を
 * 模すものなのでアプリ内のコードには依存させない。モック側の写しはこの 1 つに保つ）。
 */
export const CA_TYPE_NAMES = {
  110: '現金配当',
  112: '株式配当',
  120: '株式分割',
  121: '無償増資',
  122: '有償増資',
  123: '子会社割当',
  125: 'ワラント割当',
  130: '会社清算交付金',
  131: '合併交付金',
  140: '株式併合',
  142: '合併交付株',
  220: '通常償還',
}

const YEAR = '2026'

/**
 * 比率文字列。バックエンドの format_ratio と同じ規則
 * （どちらかが未設定なら空文字、そろっていれば `分母:分子`。小数の余分な 0 は落とす）。
 *
 * ハンドラも登録・更新した行の `比率` を組み直すのに使うので export している
 * （比率は DB の列ではなく、バックエンドが応答を組み立てるときに付ける表示項目）。
 */
export function formatRatio(denominator, numerator) {
  if (denominator == null || numerator == null) return ''
  return `${String(denominator)}:${String(numerator)}`
}

function toCaItem({ id, stock, event, canceled = false }) {
  const toDate = (monthDay) => (monthDay ? Number(`${YEAR}${monthDay}`) : null)

  return {
    ID: id,
    銘柄コード: stock.stockCode,
    Ticker: stock.ticker,
    CA種別: event.caType,
    CA種別名: CA_TYPE_NAMES[event.caType] ?? null,
    権利付最終日: toDate(event.exRights),
    効力発生日: toDate(event.effective),
    支払日: toDate(event.payment),
    分母: event.denominator,
    分子: event.numerator,
    比率: formatRatio(event.denominator, event.numerator),
    備考: event.note,
    // 実 API 未実装の仮項目（ファイル冒頭のコメント参照）。未設定は null
    ステータス: event.status ?? null,
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: event.userModified ? 1 : 0,
    作成日時: '2026-08-10T10:00:00',
    作成者: 'SYSTEM',
    更新日時: event.userModified ? '2026-08-20T09:30:00' : null,
    更新者: event.userModified ? '702' : null,
    取消日時: canceled ? '2026-08-25T11:00:00' : null,
    取消者: canceled ? '702' : null,
  }
}

/**
 * 有効な行（取消区分 0）。56 件。
 * 並べ替えは読み出し側（ハンドラ）が実 API と同じ規則で行うので、ここでは生成順のまま置く。
 */
export const corporateActions = caStocks.flatMap((stock, stockIndex) =>
  CA_EVENTS_PER_STOCK.map((event, eventIndex) =>
    toCaItem({
      // ID は 1 から通し。実 API の AUTO_INCREMENT と同じく、後から足した行ほど大きい
      id: stockIndex * CA_EVENTS_PER_STOCK.length + eventIndex + 1,
      stock,
      event,
    }),
  ),
)

/**
 * 取消済み（論理削除）の行。既定の一覧には出ない。
 * `include_deleted=true` を送ったときだけ返るので、「取消区分で外している」ことを確かめられる。
 */
export const canceledCorporateActions = [
  toCaItem({
    id: corporateActions.length + 1,
    stock: caStocks[0],
    event: {
      caType: '220',
      exRights: '0210',
      effective: '0212',
      payment: '0226',
      denominator: 1,
      numerator: 1,
      note: '取消済みの通常償還',
      status: '3',
    },
    canceled: true,
  }),
]

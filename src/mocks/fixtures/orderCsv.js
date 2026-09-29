/*
 * モックのレスポンス実体（CSV一括注文）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 *
 * `GET /orders/csv-spec` の応答（CsvHeaderSpecResponse）。全 22 列の中身は
 * バックエンドの CSV_BULK_ORDER_SPEC_METADATA（app/services/order_service.py）の写しで、
 * allowed_values は同じくバックエンドのコードマスタ（app/config/codes.json）から引いたもの。
 * 実 API は区分の列にだけ allowed_values を付け、それ以外は null を返す。
 *
 * 画面モック（docs/mock/orders-csv-upload/）の表は英語名の 17 列だが、実 API の列に合わせた
 * （2026-09-29 にユーザ確認済み）。
 */

/**
 * コードマスタの [コード, 名前] の組を allowed_values の配列に直す。
 * object で書かないのは、'01' や '000' のようなキーの並びが JS の規則で入れ替わるため
 * （整数に見えるキーだけが先に昇順で並ぶ）。
 */
function allowed(pairs) {
  return pairs.map(([code, label]) => ({ code, label }))
}

export const orderCsvColumns = [
  {
    index: 1,
    name: '部店',
    required: true,
    type: 'string',
    description: '部店コード（3桁数字。例: 101）',
    example: '101',
    condition: null,
    allowed_values: null,
  },
  {
    index: 2,
    name: '口座番号',
    required: true,
    type: 'integer',
    description: '口座番号（7桁以内の半角数字）',
    example: 1000113,
    condition: null,
    allowed_values: null,
  },
  {
    index: 3,
    name: '銘柄コード',
    required: true,
    type: 'string',
    description: '取扱銘柄コード（m_銘柄情報に登録済みのコード）',
    example: 'A0001',
    condition: null,
    allowed_values: null,
  },
  {
    index: 4,
    name: '売買区分',
    required: true,
    type: 'string',
    description: '売買区分コード（1: 売, 3: 買）',
    example: '3',
    condition: null,
    allowed_values: allowed([
      ['1', '売'],
      ['3', '買'],
    ]),
  },
  {
    index: 5,
    name: '数量',
    required: true,
    type: 'integer',
    description: '発注数量・株数（1以上の正の整数）',
    example: 100,
    condition: null,
    allowed_values: null,
  },
  {
    index: 6,
    name: '指成区分',
    required: true,
    type: 'string',
    description: '指成区分コード（LO: 指値, MO: 成行）',
    example: 'LO',
    condition: null,
    allowed_values: allowed([
      ['LO', '指値'],
      ['MO', '成行'],
    ]),
  },
  {
    index: 7,
    name: '指値単価',
    required: false,
    type: 'number',
    description: '指値単価（指成区分がLO時は必須・正の数値、MO時は省略または0）',
    // バックエンドは 150.00（JSON では 150.0）。JS で読むと 150 になるので、画面の例も「150」と出る
    example: 150,
    condition: '指成区分がLO（指値）の場合は必須',
    allowed_values: null,
  },
  {
    index: 8,
    name: '決済通貨区分',
    required: true,
    type: 'string',
    description: '決済通貨区分コード（0: 円決, 1: 外決）',
    example: '1',
    condition: null,
    allowed_values: allowed([
      ['0', '円決'],
      ['1', '外決'],
    ]),
  },
  {
    index: 9,
    name: '証券受渡方法',
    required: true,
    type: 'string',
    description: '証券受渡方法コード（100: 当社保管, 500: 他社保管）',
    example: '100',
    condition: null,
    allowed_values: allowed([
      ['100', '当社保管'],
      ['500', '他社保管'],
    ]),
  },
  {
    index: 10,
    name: '預り売買区分',
    required: true,
    type: 'string',
    description:
      '預り売買区分コード（0: 特定, 1: 非特定, 4: NISA, 6: 成長投資枠, 8: 継続管理勘定）',
    example: '0',
    condition: null,
    allowed_values: allowed([
      ['0', '特定'],
      ['1', '非特定'],
      ['4', 'NISA'],
      ['6', '成長投資枠'],
      ['8', '継続管理勘定'],
    ]),
  },
  {
    index: 11,
    name: '取引',
    required: true,
    type: 'string',
    description: '取引区分コード（100: 委託, 300: 店頭, 900: 募集）',
    example: '100',
    condition: null,
    allowed_values: allowed([
      ['100', '委託'],
      ['300', '店頭'],
      ['900', '募集'],
    ]),
  },
  {
    index: 12,
    name: '勧誘区分',
    required: true,
    type: 'string',
    description: '勧誘区分コード（1: 勧誘あり, 2: 勧誘なし）',
    example: '1',
    condition: null,
    allowed_values: allowed([
      ['1', '勧誘あり'],
      ['2', '勧誘なし'],
    ]),
  },
  {
    index: 13,
    name: '受注方法',
    required: true,
    type: 'string',
    description: '受注方法コード（1: 店頭, 2: 訪問, 3: 電話他）',
    example: '1',
    condition: null,
    allowed_values: allowed([
      ['1', '店頭'],
      ['2', '訪問'],
      ['3', '電話他'],
    ]),
  },
  {
    index: 14,
    name: '資金性格',
    required: true,
    type: 'string',
    description: '資金性格コード（1: 余裕資金, 2: その他）',
    example: '1',
    condition: null,
    allowed_values: allowed([
      ['1', '余裕資金'],
      ['2', 'その他'],
    ]),
  },
  {
    index: 15,
    name: '金銭受渡方法',
    required: true,
    type: 'string',
    description: '金銭受渡方法コード（000: 当社, 100: 他機関, 200: 国外）',
    example: '000',
    condition: null,
    allowed_values: allowed([
      ['000', '当社'],
      ['100', '他機関'],
      ['200', '国外'],
    ]),
  },
  {
    index: 16,
    name: '有効期限',
    required: true,
    type: 'string',
    description: '有効期限（YYYYMMDD形式。当日または国内14営業日以内）',
    example: '20260826',
    condition: null,
    allowed_values: null,
  },
  {
    index: 17,
    name: '注文チャネル',
    required: true,
    type: 'string',
    description: '注文チャネルコード（EGY: 営業店, CC: コール, HT: ネット）',
    example: 'EGY',
    condition: null,
    allowed_values: allowed([
      ['EGY', '営業店'],
      ['CC', 'コール'],
      ['HT', 'ネット'],
    ]),
  },
  {
    index: 18,
    name: '受注日',
    required: true,
    type: 'string',
    description: '受注日（YYYYMMDD形式）',
    example: '20260826',
    condition: null,
    allowed_values: null,
  },
  {
    index: 19,
    name: '受注時刻',
    required: true,
    type: 'string',
    description: '受注時刻（HHMMSSまたはHH:MM形式）',
    example: '090100',
    condition: null,
    allowed_values: null,
  },
  {
    index: 20,
    name: '受注者',
    required: true,
    type: 'string',
    description: '受注者社員コード',
    example: '999',
    condition: null,
    allowed_values: null,
  },
  {
    index: 21,
    name: 'VWAP区分',
    required: true,
    type: 'integer',
    description: 'VWAP対象区分コード（0: 非対象, 1: 対象）',
    example: 0,
    condition: null,
    allowed_values: allowed([
      ['0', '非対象'],
      ['1', '対象'],
    ]),
  },
  {
    index: 22,
    name: '発注範囲',
    required: true,
    type: 'string',
    description:
      '発注範囲コード（01: プレ, 02: プレ＋レギュラー, 03: レギュラー, 04: プレ＋レギュラー＋アフター, 05: レギュラー＋アフター, 06: アフター）',
    example: '03',
    condition: null,
    allowed_values: allowed([
      ['01', 'プレ'],
      ['02', 'プレ＋レギュラー'],
      ['03', 'レギュラー'],
      ['04', 'プレ＋レギュラー＋アフター'],
      ['05', 'レギュラー＋アフター'],
      ['06', 'アフター'],
    ]),
  },
]

/** `GET /orders/csv-spec` の応答そのもの */
export const orderCsvSpecResponse = {
  total_columns: orderCsvColumns.length,
  columns: orderCsvColumns,
}

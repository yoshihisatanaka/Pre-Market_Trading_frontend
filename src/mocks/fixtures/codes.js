/*
 * モックのレスポンス実体（コードマスタ・部店・扱者）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 *
 * `GET /codes` の応答（codeMasters）はバックエンドの `app/config/codes.json` の写し
 * （2026-09-30 時点。実 API はこのファイルをそのまま返す）に、追加を依頼中の 4 カテゴリ
 * （PROPOSED_CODE_MASTERS）を足したもの。形は openapi の CodesResponse のとおり
 * `{カテゴリ: {コード: 名称}}` で、`投資方針` だけが `{法人区分: {コード: 名称}}` の 2 段になる。
 * バックエンドがカテゴリや名称を変えたら、ここも写し直す。
 *
 * 部店・扱者は `/codes` に無い。実 API は `GET /branches` / `GET /handlers`（m_部店 / m_扱者情報）
 * が返すので、モックもその形（branchListResponse / handlerListResponse）で持つ。
 * 値は画面モック（docs/mock/customers-holdings/index.html の部店プルダウン）のもの。
 */

/**
 * 部店。顧客マスタのフィクスチャ（fixtures/customers.js）が 部店コード / 部店名 として
 * 使い回す。プルダウンと一覧の行で名前がずれないよう、出どころを 1 つにしてある。
 */
export const branches = [
  { code: '123', name: 'A支店' },
  { code: '234', name: 'B支店' },
  { code: '345', name: 'C支店' },
  { code: '456', name: 'D支店' },
]

/**
 * 扱者。branches と同じく fixtures/customers.js が 扱者コード / 扱者名 として使い回す。
 * branchCode は m_扱者情報 の 部店コード（顧客の行の部店とは揃えていない。画面は扱者を部店で絞らない）
 */
export const salesHandlers = [
  { code: '001', name: '田中', branchCode: '123' },
  { code: '002', name: '佐藤', branchCode: '234' },
  { code: '003', name: '鈴木', branchCode: '345' },
  { code: '004', name: '高橋', branchCode: '456' },
  { code: '005', name: '伊藤', branchCode: '123' },
  { code: '006', name: '渡辺', branchCode: '234' },
]

/** `GET /branches` の応答（BranchListResponse。部店コード昇順） */
export const branchListResponse = {
  items: branches.map(({ code, name }) => ({ 部店コード: code, 部店名: name })),
}

/** `GET /handlers` の応答（HandlerListResponse。部店コード・扱者コード昇順） */
export const handlerListResponse = {
  items: [...salesHandlers]
    .sort((a, b) => a.branchCode.localeCompare(b.branchCode) || a.code.localeCompare(b.code))
    .map(({ code, name, branchCode }) => ({ 部店コード: branchCode, 扱者コード: code, 扱者名: name })),
}

/**
 * **契約提案（バックエンドに codes.json への追加を依頼中。docs/api/requests.md）。**
 * 画面に選択肢が要るのに、実 API の /codes にも他の API にも取得先が無いカテゴリ。
 * コードは各画面がいま API に送っている値（処理状況コードなど）をそのまま使う。
 * 実 API に入ったら、codes.json の写し（CODES_JSON）へ移してここから消す。
 */
export const PROPOSED_CODE_MASTERS = {
  /** 注文照会の検索。コードは GET /orders の status に載せる処理状況コード */
  注文照会出来状況: {
    '000': '未出来',
    '003': '注文中',
    '010': '一部出来',
    '011': '全部出来',
    '034': '取消済（出来有・無）',
    101: '注文エラー',
  },
  /** 約定照会・みずほ注文締の検索。コードは GET /executions の status に載せる処理状況コード */
  約定出来状況: { '010': '一部出来', '011': '全部出来', '034': '取消済（出来有）' },
  /** 新規注文の注文種別（OrderRequest の VWAP区分。integer で送る） */
  VWAP区分: { 0: '通常', 1: 'VWAP' },
  /** 操作ログの検索（GET /operations/activity-logs の operation）。実 API の /codes の写し（2026-10-05 実測） */
  操作区分: {
    CREATE: '登録',
    UPDATE: '更新',
    DELETE: '削除',
    BATCH: '一括処理',
    SUSPEND: '停止',
    RESUME: '再開',
    SHOW: '表示',
    HIDE: '非表示',
    VWAP_BULK: 'VWAP対象一括更新',
  },
}

/**
 * app/config/codes.json の写し（書く順は原本のまま）。
 * JS の object は整数に見えるキー（'101' など）を昇順で先に並べ直すので、Object.keys の並びは
 * 原本と違う。実 API の応答を JSON.parse しても同じことが起きるので、並びに頼らない
 * （並べる規則は src/api/codes.js が持つ）。
 */
const CODES_JSON = {
  処理状況: {
    '000': '未発注',
    '002': 'IB発注中',
    '003': '注文中',
    '004': 'VWAP集計済み',
    '010': '一部出来',
    '011': '全部出来',
    '020': '不出来',
    '030': '未取消',
    '031': 'IB取消中',
    '032': 'IB取消済',
    '033': 'Dream取消中',
    '034': '取消済',
    101: 'Dream発注失敗',
    103: 'IB発注失敗',
    '040': '訂正待ち',
    131: 'IB取消失敗',
    133: 'Dream取消失敗',
    141: '訂正中断',
  },
  注文ルート: { 0: 'みずほ', 1: 'IB', 2: 'VWAP', 3: '自己取引', 4: 'OTC' },
  VWAP対象区分: { 0: '非対象', 1: '対象' },
  Dream登録状況: { 0: '未登録', 1: '登録中', 2: '登録済', 8: '登録対象外', 9: '登録失敗' },
  Dream取消状況: { 0: '取消対象外', 1: '取消中', 2: '取消済', 9: '取消失敗' },
  Dream状況: {
    0: '未登録',
    1: '登録中',
    2: '登録済',
    8: '登録対象外',
    9: '登録失敗',
    C1: '取消中',
    C2: '取消済',
    C9: '取消失敗',
  },
  特定預り区分: { 0: '一般', 1: '特定', 4: 'NISA', 6: '成長投資枠', 8: '継続管理勘定' },
  売買区分: { 1: '売', 3: '買' },
  指成区分: { LO: '指値', MO: '成行' },
  決済通貨区分: { 0: '円決', 1: '外決' },
  証券受渡方法: { 100: '当社保管', 500: '他社保管' },
  預り売買区分: { 0: '特定', 1: '一般', 4: 'NISA', 6: '成長投資枠', 8: '継続管理勘定' },
  取引: { 100: '委託', 300: '店頭', 900: '募集' },
  勧誘区分: { 1: '勧誘あり', 2: '勧誘なし' },
  受注方法: { 1: '店頭', 2: '訪問', 3: '電話他' },
  資金性格: { 1: '余裕資金等', 2: 'その他' },
  注文チャネル: { EGY: '営業店', CC: 'コール', HT: 'ネット' },
  金銭受渡方法: { '000': '当社', 100: '他機関', 200: '国外' },
  電出区分: { 0: '', 1: '電出済' },
  発注範囲: {
    '01': 'プレ',
    '02': 'プレ＋レギュラー',
    '03': 'レギュラー',
    '04': 'プレ＋レギュラー＋アフター',
    '05': 'レギュラー＋アフター',
    '06': 'アフター',
  },
  法人区分: { 0: '個人', 1: '法人' },
  投資方針: {
    0: {
      1: '利回り・安定重視',
      2: '利回り・値上り益重視',
      3: '値上り益重視',
      4: '積極的値上り益重視',
      5: '安定投資重視',
      6: 'バランス',
      7: '値上り益重視',
      9: 'その他',
    },
    1: {
      1: '政策投資',
      2: '資金運用',
      3: '元本重視',
      4: '利子・配当重視',
      5: '利子・配当と値上がりのバランスを重視',
      6: '値上り益重視',
      7: '積極的値上り追求',
      9: 'その他',
    },
  },
  強制区分: { 0: '通常', 1: '強制' },
  取引停止区分_全取引: { 0: '通常', 1: '停止' },
  取引停止区分_エクイティ商品取引_売買: { 0: '通常', 1: '停止' },
  取引停止区分_リスク商品取引_売買: { 0: '通常', 1: '停止' },
  取引停止区分_エクイティ商品取引_買: { 0: '通常', 1: '停止' },
  取引停止区分_リスク商品取引_買: { 0: '通常', 1: '停止' },
  VWAP書類受入: { 0: '未受入', 1: '受入済' },
  リスク外株書類受入: { 0: '未受入', 1: '受入済' },
  CA種別: {
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
  },
  海外休場区分: { 0: '終日休場', 1: '短縮取引' },
  外国証券同意書受入: { 0: '未受入', 1: '受入済' },
  NISA契約: { 0: '未契約', 1: '契約', 9: '解約済' },
  特定口座区分: {
    0: '未登録',
    1: '特定口座（源泉徴収あり）',
    2: '特定口座（源泉徴収なし）',
    3: '非特定',
  },
  コンプラランク: Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'X', 'Y', 'Z'].map((rank) => [rank, rank]),
  ),
  口座区分: { 0: '一般', 1: '自己', 2: '同業者' },
  事故処理口座区分: { 0: '通常', 1: '事故処理' },
  規制情報: { 0: '通常', 1: '買禁止', 2: '売禁止', 3: '売買禁止' },
}

/** `GET /codes` の応答そのもの。実 API の写しに、依頼中の契約提案を足したもの */
export const codeMasters = { ...CODES_JSON, ...PROPOSED_CODE_MASTERS }

/**
 * 画面のプルダウンに並ぶ順の `{ code, label }`。テストの期待値とフィクスチャの名前引きに使う。
 *
 * 並びはコードの文字列順（src/api/codes.js と同じ規則）。部店・扱者は /branches・/handlers から
 * 合成したもので、label はモックのプルダウン表示（「123 A支店」）に合わせてコードを前置する。
 *
 * @param {string} name コードマスタ名（'口座区分' など。'部店' / '扱者' も可）
 * @param {string} [context] 2 段のカテゴリ（投資方針）の 1 段目のキー（法人区分）
 * @returns {Array<{ code: string, label: string }>}
 */
export function codeEntries(name, context) {
  if (name === '部店') return branches.map(({ code, name: n }) => ({ code, label: `${code} ${n}` }))
  if (name === '扱者') {
    return handlerListResponse.items.map((item) => ({
      code: item.扱者コード,
      label: `${item.扱者コード} ${item.扱者名}`,
    }))
  }
  const table = context === undefined ? codeMasters[name] : codeMasters[name]?.[context]
  return Object.entries(table ?? {})
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
}

/**
 * コード → 名称（実 API が行に付ける `*名` の組み立てに使う）。知らないコードは null。
 *
 * @param {string} name コードマスタ名
 * @param {string|number|null|undefined} code
 * @param {string|number} [context] 投資方針のときの法人区分
 */
export function codeName(name, code, context) {
  const table = context === undefined ? codeMasters[name] : codeMasters[name]?.[String(context)]
  return code == null ? null : (table?.[String(code)] ?? null)
}

/** 特定預り区分のコード → 名前。残高マスタの行を組み立てるときに引く */
export const SPECIFIC_DEPOSIT_NAMES = codeMasters.特定預り区分

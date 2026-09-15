import {
  accountTypeCodes,
  branches,
  corporateTypeCodes,
  investmentPolicyCodes,
  restrictionCodes,
  salesHandlers,
} from './codes'

/*
 * モックのレスポンス実体（顧客マスタ）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の CustomerItem（m_口座情報 の行モデル）に合わせてある
 * （プロパティ名は日本語、口座番号は integer、取消区分・ユーザー操作フラグは 0/1）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 画面が使わない項目（各種書類受入・商品別の取引停止区分・特定口座区分）は省いている。
 * 実 API はこれらも返すが、持たせても一覧の確認には効かず読みにくくなるだけなので入れない。
 *
 * 区分の名前（取引停止区分_全取引名 など）はコードマスタ（fixtures/codes.js）から引く。
 * プルダウンの選択肢と一覧の表示名を同じ出どころにして、モックの中でずれないようにする。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 部店 4 × 顧客 14 = 56 件を作り、うち 12 件（部店ごとの 3 件）を
 * ユーザー操作フラグ=1（手動操作された行。一覧で色が付く）にしてある。
 */

/** コード → 区分名。コードマスタの label がそのまま区分名になる */
const nameOf = (codes, code) => codes.find((entry) => entry.code === code)?.label ?? null

/**
 * 1 部店あたりの顧客。14 件。部店ごとに同じ並びで作り、口座番号と扱者だけがずれる。
 *
 * 画面で確かめたい条件を必ず 1 件は含める。
 *   - userModified … 行に色が付く
 *   - restriction '1' … 取引規制のバッジ
 *   - accident … 口座区分に「事故」のバッジ
 *   - corporate … 法人（生年月日 '0'、年齢なし）
 *   - cashUsd / growthQuota が null … 金額列の '—'
 */
const CUSTOMERS_PER_BRANCH = [
  {
    name: '山田 太郎',
    kana: 'ﾔﾏﾀﾞ ﾀﾛｳ',
    birth: '19500214',
    age: '75',
    policy: '1',
    rank: 'A',
    accountType: '0',
    cashJpy: 3500000,
    cashUsd: 50000,
    growthQuota: 1200000,
  },
  {
    name: '佐藤 花子',
    kana: 'ｻﾄｳ ﾊﾅｺ',
    birth: '19620708',
    age: '63',
    policy: '3',
    rank: 'B',
    accountType: '0',
    cashJpy: 820000,
    cashUsd: 12500.5,
    growthQuota: 2400000,
    userModified: true,
  },
  {
    name: '鈴木 一郎',
    kana: 'ｽｽﾞｷ ｲﾁﾛｳ',
    birth: '19781130',
    age: '46',
    policy: '4',
    rank: 'B',
    accountType: '0',
    cashJpy: 150000,
    // 外貨預り金なし（画面では '—' になる）
    cashUsd: null,
    growthQuota: 2400000,
  },
  {
    name: '高橋 みどり',
    kana: 'ﾀｶﾊｼ ﾐﾄﾞﾘ',
    birth: '19850322',
    age: '40',
    policy: '5',
    rank: 'C',
    accountType: '0',
    // 残高 0。「値が無い」（null）と区別できることを確かめる行
    cashJpy: 0,
    cashUsd: 3200.25,
    // NISA 未契約のため買付可能額なし（画面では '—' になる）
    growthQuota: null,
    nisaContract: '0',
  },
  {
    name: '伊藤 健二',
    kana: 'ｲﾄｳ ｹﾝｼﾞ',
    birth: '19450901',
    age: '80',
    policy: '1',
    rank: 'D',
    accountType: '0',
    // 全取引停止（画面では取引規制のバッジが出る）
    restriction: '1',
    cashJpy: 6100000,
    cashUsd: 0,
    growthQuota: 1200000,
  },
  {
    name: '渡辺 良子',
    kana: 'ﾜﾀﾅﾍﾞ ﾖｼｺ',
    birth: '19551018',
    age: '69',
    policy: '2',
    rank: 'A',
    accountType: '0',
    cashJpy: 12400000,
    cashUsd: 185000.75,
    growthQuota: 0,
  },
  {
    name: '中村 修',
    kana: 'ﾅｶﾑﾗ ｵｻﾑ',
    birth: '19700605',
    age: '55',
    policy: '3',
    rank: 'B',
    accountType: '0',
    // 事故処理口座（画面では口座区分の横に「事故」のバッジが出る）
    accident: true,
    cashJpy: 450000,
    cashUsd: 7800,
    growthQuota: 2400000,
    userModified: true,
  },
  {
    name: '小林 さくら',
    kana: 'ｺﾊﾞﾔｼ ｻｸﾗ',
    birth: '19930427',
    age: '32',
    policy: '5',
    rank: 'C',
    accountType: '0',
    cashJpy: 98000,
    cashUsd: 1500,
    growthQuota: 2400000,
  },
  {
    name: '株式会社インディペンデンス',
    kana: 'ｶ)ｲﾝﾃﾞｲﾍﾟﾝﾃﾞﾝｽ',
    // 法人は 生年月日 '0'・年齢なし（AccountItem の description のとおり）
    corporate: true,
    birth: '0',
    age: '',
    policy: '2',
    rank: 'A',
    // 自己口座
    accountType: '1',
    cashJpy: 88000000,
    cashUsd: 920000,
    // 法人は NISA を持たない
    growthQuota: null,
    nisaContract: '0',
  },
  {
    name: '有限会社サンライズ商事',
    kana: 'ﾕ)ｻﾝﾗｲｽﾞｼﾖｳｼﾞ',
    corporate: true,
    birth: '0',
    age: '',
    policy: '4',
    rank: 'B',
    // 同業者口座
    accountType: '2',
    cashJpy: 4300000,
    cashUsd: null,
    growthQuota: null,
    nisaContract: '0',
  },
  {
    name: '加藤 信彦',
    kana: 'ｶﾄｳ ﾉﾌﾞﾋｺ',
    birth: '19680212',
    age: '57',
    policy: '3',
    rank: 'X',
    accountType: '0',
    cashJpy: 2750000,
    cashUsd: 41200.4,
    growthQuota: 600000,
  },
  {
    name: '吉田 亜美',
    kana: 'ﾖｼﾀﾞ ｱﾐ',
    birth: '19880916',
    age: '37',
    policy: '5',
    rank: 'C',
    accountType: '0',
    cashJpy: 320000,
    cashUsd: 9900.1,
    growthQuota: 2400000,
  },
  {
    name: '山本 剛',
    kana: 'ﾔﾏﾓﾄ ﾂﾖｼ',
    birth: '19731203',
    age: '51',
    policy: '4',
    rank: 'B',
    accountType: '0',
    // 停止中かつ手動操作された行（バッジと行の色が同時に出る）
    restriction: '1',
    cashJpy: 1050000,
    cashUsd: 23000,
    growthQuota: 1800000,
    userModified: true,
  },
  {
    name: '松本 久美子',
    kana: 'ﾏﾂﾓﾄ ｸﾐｺ',
    birth: '19591125',
    age: '65',
    policy: '1',
    rank: 'A',
    accountType: '0',
    cashJpy: 9600000,
    cashUsd: 132500,
    growthQuota: 1200000,
  },
]

/**
 * 1 行を組み立てる。
 *
 * 口座番号は「部店コード + 4 桁の連番」の integer（'123' + '0001' → 1230001）。
 * 昇順に並べると部店ごとにまとまる。
 */
function toAccountItem({ branch, handler, seq, profile, canceled = false }) {
  const restriction = profile.restriction ?? '0'
  const accidentAccount = profile.accident ? '1' : '0'
  const corporateType = profile.corporate ? '1' : '0'
  const nisaContract = profile.nisaContract ?? '1'

  return {
    口座番号: Number(`${branch.code}${String(seq).padStart(4, '0')}`),
    部店コード: branch.code,
    部店名: branch.name,
    扱者コード: handler.code,
    扱者名: handler.name,
    法人区分: corporateType,
    法人区分名: nameOf(corporateTypeCodes, corporateType),
    顧客名: profile.name,
    顧客名カナ: profile.kana,
    生年月日: profile.birth,
    年齢: profile.age,
    コンプラランク: profile.rank,
    // コンプラランクはコードがそのまま名前（ComplianceRankEnum に名前の対応表が無い）
    コンプラランク名: profile.rank,
    投資方針: profile.policy,
    投資方針名: nameOf(investmentPolicyCodes, profile.policy),
    // 総預り資産は円貨と外貨の合計（1 ドル 150 円で換算した、モック限りの概算）
    総預り資産: (profile.cashJpy ?? 0) + Math.round((profile.cashUsd ?? 0) * 150),
    NISA契約: nisaContract,
    NISA契約名: nisaContract === '1' ? '契約' : '未契約',
    NISA買付可能額_当年: profile.growthQuota,
    NISA買付可能額_翌年: profile.growthQuota === null ? null : 2400000,
    円貨預り金: profile.cashJpy,
    外貨預り金: profile.cashUsd,
    // 取引停止区分だけ integer（法人区分や事故処理口座区分は文字列。実 API の型の差をそのまま持つ）
    取引停止区分_全取引: Number(restriction),
    取引停止区分_全取引名: nameOf(restrictionCodes, restriction),
    口座区分: profile.accountType,
    口座区分名: nameOf(accountTypeCodes, profile.accountType),
    事故処理口座区分: accidentAccount,
    事故処理口座区分名: profile.accident ? '事故処理' : '通常',
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: profile.userModified ? 1 : 0,
    作成日時: '2026-04-01T09:00:00',
    作成者: 'SYSTEM',
    更新日時: profile.userModified ? '2026-09-03T14:20:00' : null,
    更新者: profile.userModified ? '702' : null,
    取消日時: canceled ? '2026-08-28T16:40:00' : null,
    取消者: canceled ? '702' : null,
  }
}

/**
 * 有効な行（取消区分 0）。56 件。
 * 並べ替えは読み出し側（ハンドラ）が実 API と同じ規則で行うので、ここでは生成順のまま置く。
 */
export const customers = branches.flatMap((branch, branchIndex) =>
  CUSTOMERS_PER_BRANCH.map((profile, profileIndex) =>
    toAccountItem({
      branch,
      // 扱者は部店をまたいで順に割り当てる（6 人なので部店ごとに担当がずれる）
      handler:
        salesHandlers[
          (branchIndex * CUSTOMERS_PER_BRANCH.length + profileIndex) % salesHandlers.length
        ],
      seq: profileIndex + 1,
      profile,
    }),
  ),
)

/**
 * 削除済み（取消区分 1）の行。既定の一覧には出ない。
 * `include_deleted=true` を送ったときだけ返るので、「取消区分で外している」ことを確かめられる。
 */
export const canceledCustomers = [
  toAccountItem({
    branch: branches[0],
    handler: salesHandlers[0],
    seq: 99,
    profile: {
      name: '解約 済子',
      kana: 'ｶｲﾔｸ ｽﾐｺ',
      birth: '19801001',
      age: '44',
      policy: '3',
      rank: 'Z',
      accountType: '0',
      cashJpy: 0,
      cashUsd: 0,
      growthQuota: null,
      nisaContract: '9',
    },
    canceled: true,
  }),
]

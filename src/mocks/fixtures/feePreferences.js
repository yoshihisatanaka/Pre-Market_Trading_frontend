import { canceledCustomers, customers } from './customers'

/*
 * モックのレスポンス実体（手数料優遇マスタ）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の FeePreferenceItem に合わせてある
 * （プロパティ名は日本語、口座番号は integer、取消区分・ユーザー操作フラグは 0/1、数値の未設定は null）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 部店コード / 顧客名 / 適用方式 は DB の列ではなく、バックエンドが応答を組み立てるときに付ける項目
 * （前 2 つは口座マスタの結合、適用方式はベイシスの有無から決まる）。生の応答には載るのでここでも持つ。
 *
 * 口座は顧客マスタのフィクスチャ（4 部店 × 14 件）から借りる。1 部店あたり先頭 13 件に優遇を付け、
 * **14 件目（seq 14）の口座は優遇なしのまま残す**。新規追加で「登録の無い口座」を選べるようにするため
 * （1 口座 1 レコードなので、全口座に付けると追加が必ず重複になる）。
 * 4 部店 × 13 件 = 52 件で、1 ページ（50 件）を超える。
 */

/**
 * 1 部店あたりの優遇。顧客マスタの並び（CUSTOMERS_PER_BRANCH）の先頭 13 件に順に当てる。
 * 手数料パターンは A〜D だけを使う（ハンドラが「手数料パターンマスタに登録済み」と見なす範囲）。
 * userModified が付いた行は画面から手を入れた行（更新日時・更新者が入る）。
 */
const PREFERENCES_PER_BRANCH = [
  // 為替手数料の免除だけ（手数料はデフォルトパターンのまま）
  { feePattern: '', fxSpread: 0 },
  { feePattern: 'A', feeMultiplier: 80 },
  { feePattern: 'B', feeMultiplier: 50, minFee: 1000, maxFee: 50000 },
  { basisPoints: 30, minBasisFee: 500, maxBasisFee: 30000 },
  { feePattern: '', feeMultiplier: 90, fxSpread: 0.25 },
  { feePattern: 'C', userModified: true },
  { basisPoints: 25, fxSpread: 0 },
  { feePattern: 'A', fxSpread: 0.3 },
  { feePattern: 'D', feeMultiplier: 70, maxFee: 100000, userModified: true },
  { basisPoints: 20, maxBasisFee: 100000 },
  { feePattern: '', fxSpread: 0.5 },
  { feePattern: 'B', feeMultiplier: 100, minFee: 0 },
  // スプレッドは小数第 4 位まで（実 API の DB は小数 4 桁）
  { basisPoints: 40, minBasisFee: 1000, fxSpread: 0.1234, userModified: true },
]

/** 顧客マスタの 1 部店あたりの件数（customers は部店ごとに 14 件ずつ並ぶ） */
const CUSTOMERS_PER_BRANCH = 14

/**
 * 適用方式。ベイシスを設定した口座はベイシス方式、それ以外はパターン方式
 * （FeePreferenceRequest の説明「ベイシス。設定時はパターン方式の適用外」）。
 * ハンドラも登録・更新した行の 適用方式 を組み直すのに使うので export している。
 */
export function applyMethodOf(basisPoints) {
  return basisPoints === null || basisPoints === undefined ? 'PATTERN' : 'BASIS'
}

function toFeePreferenceItem({ id, customer, preference, canceled = false }) {
  const basisPoints = preference.basisPoints ?? null

  return {
    ID: id,
    口座番号: customer.口座番号,
    手数料パターン: preference.feePattern ?? '',
    掛目: preference.feeMultiplier ?? null,
    下限手数料: preference.minFee ?? null,
    上限手数料: preference.maxFee ?? null,
    ベイシス: basisPoints,
    下限ベイシス円: preference.minBasisFee ?? null,
    上限ベイシス円: preference.maxBasisFee ?? null,
    スプレッド: preference.fxSpread ?? null,
    部店コード: customer.部店コード,
    顧客名: customer.顧客名,
    適用方式: applyMethodOf(basisPoints),
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: preference.userModified ? 1 : 0,
    作成日時: '2026-10-01T10:00:00',
    作成者: '702',
    更新日時: preference.userModified ? '2026-10-05T15:30:00' : null,
    更新者: preference.userModified ? '702' : null,
    取消日時: canceled ? '2026-10-06T11:00:00' : null,
    取消者: canceled ? '702' : null,
  }
}

/**
 * 有効な行（取消区分 0）。52 件。
 * 並べ替えは読み出し側（ハンドラ）が行うので、ここでは生成順（口座番号の昇順）のまま置く。
 */
export const feePreferences = customers
  .filter((_, index) => index % CUSTOMERS_PER_BRANCH < PREFERENCES_PER_BRANCH.length)
  .map((customer, index) =>
    toFeePreferenceItem({
      // ID は 1 から通し。実 API の AUTO_INCREMENT と同じく、後から足した行ほど大きい
      id: index + 1,
      customer,
      preference: PREFERENCES_PER_BRANCH[index % PREFERENCES_PER_BRANCH.length],
    }),
  )

/**
 * 取消済み（論理削除）の行。既定の一覧には出ない。
 * `include_deleted=true` を送ったときだけ返るので、「取消区分で外している」ことを確かめられる。
 * 口座は解約済みの顧客のもの（有効な口座に重ねると、再登録が重複になるかどうかが未確認の論点に触れるため）。
 */
export const canceledFeePreferences = [
  toFeePreferenceItem({
    id: feePreferences.length + 1,
    customer: canceledCustomers[0],
    preference: { feePattern: 'A', feeMultiplier: 60 },
    canceled: true,
  }),
]

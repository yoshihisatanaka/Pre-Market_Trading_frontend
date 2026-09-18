import { SPECIFIC_DEPOSIT_NAMES } from './codes'
import { customers } from './customers'
import { symbols } from './symbols'

/*
 * モックのレスポンス実体（残高マスタ）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の BalanceAdjustmentItem（m_残高情報 の行モデル）に合わせてある
 * （プロパティ名は日本語、口座番号は integer、取消区分・ユーザー操作フラグは 0/1）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * 顧客（口座番号 / 部店 / 扱者 / 顧客名）は fixtures/customers.js、銘柄（銘柄コード /
 * Ticker / 銘柄名）は fixtures/symbols.js から引く。出どころを 1 つにして、
 * 顧客マスタ・銘柄マスタと突き合わせたときに名前がずれないようにする。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 先頭 12 顧客に 5 / 5 / 4 / … 件ずつ保有を割り当てて 62 件にしてある。混ぜてあるもの:
 *   - 特定預り区分 5 種すべて（0 非特定 / 1 特定 / 4 NISA / 6 成長投資枠 / 8 継続管理勘定）
 *   - 更新日時・更新者が null の行（最終更新が '—' になる。大半がこれ）
 *   - ユーザー操作フラグ=1（手動補正された行。一覧で色が付く）を 1・2 ページ目の双方に
 *   - 初期残高 が null の行（バッチ取込に無い、手で足された保有）
 *   - 売却不可区分=1 の行（一覧に赤いバッジが出る）を 1・2 ページ目の双方に
 *   - 同じ顧客が複数銘柄を持つ行 / 同じ銘柄を複数の口座区分で持つ行
 */

/** 保有を作る対象の顧客。1 ページ（50 件）を確実に超えるよう先頭 12 件を使う */
const CUSTOMER_COUNT = 12

/**
 * 1 顧客あたりの保有の作りかた。
 * `銘柄の通し番号のずらし幅` と `口座区分` の組を並べ、顧客ごとに先頭から必要な数だけ使う。
 * 同じ銘柄を違う口座区分で 2 件持つ組（offset が同じ行）をわざと入れてある。
 */
const HOLDING_PLAN = [
  { symbolOffset: 0, deposit: '1' },
  { symbolOffset: 1, deposit: '1' },
  { symbolOffset: 2, deposit: '4' },
  { symbolOffset: 2, deposit: '0' },
  { symbolOffset: 3, deposit: '6' },
  { symbolOffset: 4, deposit: '8' },
]

/** 顧客ごとの保有件数。合計 62 件（1 ページ 50 件を超える） */
const HOLDINGS_PER_CUSTOMER = [6, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4]

/** 数量の見本。銘柄と顧客の組み合わせで循環させる（意味は無く、桁のばらつきだけが目的） */
const QUANTITIES = [200, 120, 80, 100, 50, 60, 30, 150, 300, 500, 1000, 400]

/**
 * 手で補正された行（ユーザー操作フラグ=1・更新日時と更新者あり）にする位置。
 * 1 ページ目（0〜49）と 2 ページ目（50〜61）の両方に入れて、
 * 「最終更新が '—' の行」と「日時＋更新者の 2 段の行」がどちらのページにも出るようにする。
 */
const MODIFIED_INDEXES = new Set([3, 11, 26, 44, 53, 58])

/** 初期残高を持たない（＝手で足された）行の位置。バッチ取込に無い保有 */
const MANUAL_INDEXES = new Set([11, 44, 58])

/**
 * 売却を止めてある行の位置。一覧に赤いバッジ（売却不可）が出る。
 * **`売却不可区分` は openapi.json に無い項目**（2026-09-18 時点で画面モックにだけある）。
 * 経緯は src/api/balanceAdjustments.js の冒頭コメント。
 */
const SELL_PROHIBITED_INDEXES = new Set([3, 8, 26, 55])

/** 更新者に使う扱者コード。fixtures/codes.js の salesHandlers のコード */
const UPDATED_BY = ['001', '004', '005']

function toBalanceItem({ id, customer, symbol, deposit, balance, index, canceled = false }) {
  const modified = MODIFIED_INDEXES.has(index)
  const manual = MANUAL_INDEXES.has(index)

  return {
    // 主キー。実 API の AUTO_INCREMENT を模して 1 からの連番
    ID: id,
    部店コード: customer.部店コード,
    口座番号: customer.口座番号,
    銘柄コード: symbol.銘柄コード,
    特定預り区分: deposit,
    特定預り区分名: SPECIFIC_DEPOSIT_NAMES[deposit] ?? null,
    // 実 API は同じ値を別名でも返す（BalanceAdjustmentItem の「特定預り区分名のエイリアス」）
    預り区分名: SPECIFIC_DEPOSIT_NAMES[deposit] ?? null,
    /*
     * バッチ取込時の元残高。手で足した保有は持たない（null）。
     * 補正された行は「取込値から動いている」ことが分かるよう、現在残高と別の値にする。
     */
    初期残高: manual ? null : modified ? balance - 50 : balance,
    残高: balance,
    扱者コード: customer.扱者コード,
    扱者名: customer.扱者名,
    顧客名: customer.顧客名,
    顧客名カナ: customer.顧客名カナ,
    Ticker: symbol.Ticker,
    銘柄名: symbol.銘柄名_英字,
    売却不可区分: SELL_PROHIBITED_INDEXES.has(index) ? 1 : 0,
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: modified ? 1 : 0,
    作成日時: '2026-08-27T07:00:00',
    作成者: 'SYSTEM',
    更新日時: modified ? '2026-08-27T09:10:00' : null,
    更新者: modified ? UPDATED_BY[index % UPDATED_BY.length] : null,
    取消日時: canceled ? '2026-09-01T10:30:00' : null,
    取消者: canceled ? '005' : null,
  }
}

/**
 * 有効な行（取消区分 0）。62 件。
 * 並べ替えは読み出し側（ハンドラ）が実 API と同じ規則で行うので、ここでは生成順のまま置く。
 */
export const balanceAdjustments = (() => {
  const rows = []

  for (let customerIndex = 0; customerIndex < CUSTOMER_COUNT; customerIndex += 1) {
    const customer = customers[customerIndex]
    const count = HOLDINGS_PER_CUSTOMER[customerIndex]

    for (let holdingIndex = 0; holdingIndex < count; holdingIndex += 1) {
      const plan = HOLDING_PLAN[holdingIndex]
      // 顧客ごとに使う銘柄をずらして、同じ銘柄が全顧客に並ばないようにする
      const symbol = symbols[(customerIndex * 3 + plan.symbolOffset) % symbols.length]
      const index = rows.length

      rows.push(
        toBalanceItem({
          id: index + 1,
          customer,
          symbol,
          deposit: plan.deposit,
          balance: QUANTITIES[index % QUANTITIES.length],
          index,
        }),
      )
    }
  }

  return rows
})()

/**
 * 削除済み（取消区分 1）の行。既定の一覧には出ない。
 * `include_deleted=true` を送ったときだけ返るので、「取消区分で外している」ことを確かめられる。
 */
export const canceledBalanceAdjustments = [
  toBalanceItem({
    id: balanceAdjustments.length + 1,
    customer: customers[0],
    symbol: symbols[symbols.length - 1],
    deposit: '1',
    balance: 0,
    // 補正・手動追加のどちらの印も付かない位置を渡す（62 以降は MODIFIED / MANUAL に無い）
    index: balanceAdjustments.length,
    canceled: true,
  }),
]

import { apiClient } from './client'

/*
 * 残高マスタ（実 API `/masters/balance-adjustments`。m_残高情報 の検索と補正）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 5 点。
 *   - プロパティ名が日本語（口座番号 / 銘柄コード / 特定預り区分 / 残高 …）
 *   - クエリ名は英語の snake_case（branch_code / account_no / symbol / customer_name）
 *   - 口座番号は integer で、クエリ名も `account_no`。アプリ内は文字列（行キーと URL で使う）
 *   - 一覧の配列名が `balances`、1 件の入れ物が `balance`
 *   - ユーザー操作フラグが 0 / 1 の integer。アプリ内は boolean
 *
 * **`残高` は加算値ではなく補正後の絶対値。** 実 API に「加算」という概念は無い。
 * 画面は「加算数量」で入力させるので、`補正前 + 加算 = 補正後` の変換が要るが、
 * それは **view が行う**（集計パネルと確認ステップのために同じ値をすでに computed で
 * 持っており、画面に出ている数と送る数を同一にできるため。src/views/BalanceAdjustmentListView.vue）。
 * ここに足し算を置くと「加算式 UI」という画面の都合がワイヤ層に漏れる。
 *
 * **実 API に送り先の無い画面項目が 3 つある**（画面モックにはあるが仕様に無い）。
 *   1. 検索の「銘柄名」… GET のクエリは branch_code / account_no / symbol / customer_name の
 *      4 つだけで、銘柄名に当たるものが無い。ここでは `symbol_name` という綴りで送っておき、
 *      **MSW のハンドラだけがそれを解釈して絞り込む**（FastAPI は知らないクエリを無視するので
 *      送っても害は無い。src/api/customers.js の handler_code と同じ扱い）。
 *      **MSW を切って実 API に当てると、この欄は黙って効かなくなる。** 仕様追加を依頼する対象
 *   2. 新規追加の「ティッカー」… BalanceAdjustmentRequest の必須は `銘柄コード` で Ticker が無い。
 *      入力値をそのまま 銘柄コード として送る。実 API が Ticker を解決してくれるかは未確認
 *   3. 新規追加の「銘柄名」… 本文に項目が無い。確認ステップの表示だけに使い、送らない
 *      （登録後の 銘柄名 はサーバが m_銘柄情報 から結合して返す）
 *   4. 一覧の「売却不可区分」と行操作の「売却を停止 / 売却停止を解除」…
 *      **`売却不可区分` という項目が openapi.json のどこにも無い**（2026-09-18 時点）。
 *      画面モックは専用の口（`POST .../sell-prohibited`）へ 0 / 1 を送るが、実 API には
 *      それが無いので、ここでは既存の部分更新（`PUT .../{id}`）に `売却不可区分` を
 *      1 項目足す形にしている。**いまはモックだけが解釈する。** 仕様追加を依頼する対象で、
 *      専用エンドポイントになるならこの関数を割るだけで済む
 *
 * いまは一覧・登録・更新の 3 本だけを持つ。事前検証（/validate）・削除・更新履歴・
 * CSV 入出力は画面モックに導線が無いので作らない。
 * 更新系の `X-User-Code` ヘッダは client.js の interceptor が全 API 共通で付ける。
 */

/**
 * 1 件のアプリ内モデル（このファイルの JSDoc で使う）
 *
 * @typedef {{
 *   id: string,
 *   branchCode: string,
 *   accountNumber: string,
 *   symbolCode: string,
 *   specificDeposit: string,
 *   specificDepositName: string,
 *   initialBalance: number|null,
 *   balance: number,
 *   handlerCode: string,
 *   handlerName: string,
 *   customerName: string,
 *   customerNameKana: string,
 *   ticker: string,
 *   symbolName: string,
 *   sellProhibited: boolean,
 *   userModified: boolean,
 *   updatedAt: string,
 *   updatedBy: string,
 * }} BalanceAdjustment
 *   id は実 API の ID（integer）を文字列にしたもので、一覧の行キーになる。
 *   sellProhibited は売却を止めている保有（一覧で赤いバッジが付く）。
 *   balance は現在数量。initialBalance は取込時の元残高で、手動追加分は null
 *   （0 と「値が無い」は意味が違うので潰さない）。
 *   updatedAt は楽観的ロックの合札としてそのまま更新へ送り返す。
 *   userModified は ユーザー操作フラグ=1（手動補正された行）。一覧で色を付ける印になる
 */

/**
 * 残高の一覧を取得する。
 *
 * ページャーを持つ一覧なので、配列ではなく `{ items, total }` を返す。
 *
 * 削除済み（取消区分 1）の行は含めない。実 API の include_deleted は既定 false なので送らない。
 *
 * `limit` は 1〜200 で既定 50。ページャーの表示件数は
 * stores/balanceAdjustments.js の BALANCE_ADJUSTMENTS_PAGE_SIZE が決め、その値がここへ渡ってくる。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   branchCode?: string,
 *   accountNumber?: string,
 *   customerName?: string,
 *   ticker?: string,
 *   symbolName?: string,
 * }} [params]
 *   customerName は顧客名・顧客名カナの両方に効く。ticker は 銘柄コード と Ticker の両方に効く
 *   （実 API の `symbol` がどちらにも当たるかは未確認）。symbolName は実 API に送り先が無く、
 *   モックだけが解釈する。空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: BalanceAdjustment[], total: number }>} 口座番号 → 銘柄コード の昇順
 */
export async function fetchBalanceAdjustments({
  limit = 50,
  offset = 0,
  branchCode = '',
  accountNumber = '',
  customerName = '',
  ticker = '',
  symbolName = '',
} = {}) {
  const { data } = await apiClient.get('/masters/balance-adjustments', {
    // クエリ名と 口座番号 が integer であることを知ってよいのは、この層だけ。
    // 値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      customer_name: customerName || undefined,
      symbol: ticker || undefined,
      // 実 API に無いクエリ。モックだけが解釈する（冒頭コメントの 1 番）
      symbol_name: symbolName || undefined,
    },
  })

  return {
    items: (data.balances ?? []).map(toBalanceAdjustment),
    total: data.total ?? 0,
  }
}

/**
 * 残高を 1 件新規に登録する（画面モックの「新規保有を追加」）。
 *
 * スピンオフのように、取込に無い保有を手で足すための口。
 *
 * @param {{
 *   branchCode?: string,
 *   accountNumber: string,
 *   symbolCode: string,
 *   specificDeposit: string,
 *   balance: number,
 * }} params
 *   balance は補正後の絶対値（新規なので加算数量と一致する）。
 *   branchCode は省略でき、その場合はサーバが口座情報から補完する
 * @returns {Promise<BalanceAdjustment>} 登録された 1 件
 */
export async function createBalanceAdjustment({
  branchCode = '',
  accountNumber,
  symbolCode,
  specificDeposit,
  balance,
}) {
  const { data } = await apiClient.post('/masters/balance-adjustments', {
    // 未入力のときは項目ごと送らない（サーバが口座情報から補完する）
    ...(branchCode ? { 部店コード: branchCode } : {}),
    口座番号: toAccountNo(accountNumber),
    銘柄コード: symbolCode,
    特定預り区分: specificDeposit,
    残高: balance,
  })

  return toBalanceAdjustment(data.balance)
}

/**
 * 既存の残高を 1 件更新する（画面モックの「数量を加算」と「売却を停止 / 解除」）。
 *
 * 本文は部分更新（BalanceAdjustmentUpdateRequest）。**渡した項目だけ**を送るので、
 * 数量の補正なら `balance`、売却可否の切り替えなら `sellProhibited` だけを渡す。
 * 口座番号・銘柄コード・口座区分は変えられない。
 *
 * @param {{ id: string, balance?: number, sellProhibited?: boolean, updatedAt?: string }} params
 *   balance は補正後の絶対値（加算数量ではない）。
 *   sellProhibited は実 API に無い項目（冒頭コメントの 4 番）。
 *   updatedAt は一覧で取得したときの更新日時。取得後に他の担当者が更新していれば 409 になる
 * @returns {Promise<BalanceAdjustment>} 更新後の 1 件
 */
export async function updateBalanceAdjustment({
  id,
  balance,
  sellProhibited,
  updatedAt = '',
}) {
  const { data } = await apiClient.put(`/masters/balance-adjustments/${encodeURIComponent(id)}`, {
    // 部分更新なので、渡された項目だけを本文に載せる
    ...(balance === undefined ? {} : { 残高: balance }),
    // フラグは実 API の他の区分に合わせて 0 / 1 の integer で送る
    ...(sellProhibited === undefined ? {} : { 売却不可区分: sellProhibited ? 1 : 0 }),
    // 未取得（null）のときは送らない。サーバ側は「合札なし」として扱う
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  })

  return toBalanceAdjustment(data.balance)
}

/** BalanceAdjustmentItem → アプリ内モデル */
function toBalanceAdjustment(raw) {
  return {
    // 実 API の ID は integer。画面と行キーでは文字列として扱う
    id: String(raw?.ID ?? ''),
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    branchCode: raw?.部店コード ?? '',
    accountNumber: String(raw?.口座番号 ?? ''),
    symbolCode: raw?.銘柄コード ?? '',
    specificDeposit: raw?.特定預り区分 ?? '',
    /*
     * 表示名はサーバが付けて返す。`預り区分名` は `特定預り区分名` の別名で、
     * どちらか片方しか来ない可能性があるので両方見る
     * （名前が無ければ画面が src/utils/balanceTypes.js の対応表に落とす）。
     */
    specificDepositName: raw?.特定預り区分名 ?? raw?.預り区分名 ?? '',
    // 取込時の元残高。手動追加分は null。0 と「値が無い」は別物なので潰さない
    initialBalance: toQuantity(raw?.初期残高),
    // 現在数量。必須項目なので、欠けていたら 0 として扱う
    balance: toQuantity(raw?.残高) ?? 0,
    handlerCode: raw?.扱者コード ?? '',
    handlerName: raw?.扱者名 ?? '',
    customerName: raw?.顧客名 ?? '',
    customerNameKana: raw?.顧客名カナ ?? '',
    ticker: raw?.Ticker ?? '',
    symbolName: raw?.銘柄名 ?? '',
    // 実 API にはまだ無い項目なので、欠けていれば「売却可」として扱う
    sellProhibited: raw?.売却不可区分 === 1,
    userModified: raw?.ユーザー操作フラグ === 1,
    // 更新の合札としてそのまま送り返すので、形を変えずに運ぶ
    updatedAt: raw?.更新日時 ?? '',
    updatedBy: raw?.更新者 ?? '',
  }
}

/**
 * 口座番号 → リクエストに載せる integer。
 * 実 API の 口座番号 は integer なので、数字だけのときにだけ送る
 * （文字列のまま送ると 422 で弾かれ、検索できない理由が画面に出ない）。
 */
function toAccountNo(value) {
  const digits = String(value ?? '').trim()
  return /^\d+$/.test(digits) ? Number(digits) : undefined
}

/** nullable な数量 → 数値または null（数値でないものは値が無いものとして扱う） */
function toQuantity(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

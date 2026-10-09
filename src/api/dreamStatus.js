import { apiClient } from './client'

/*
 * Dream登録状況（実 API `/orders/dream-status`。タグは DreamStatus）。
 *
 * 成熟度 B。一覧（`GET /orders/dream-status`）・状況コード一覧（`GET /orders/dream-status/statuses`）・
 * STS変更（`PUT /orders/dream-status/{order_id}`）の 3 本が仕様にあり、3 本とも持つ。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり:
 *   - プロパティ名が日本語（Dream状況 / 受注番号 / 部店 / 口座番号 …）。一覧の配列名は `orders`
 *   - **検索クエリ名は英語**（`branch_code` / `account_no` / `symbol` / `dream_status` /
 *     `start_date` / `end_date` / `receipt_number`）。レスポンスの日本語キーと対応しないので混同しない
 *   - 主キーは integer の `ID`（注文ID）。アプリ内は文字列の `id`（src/api/ca.js と同じ扱い）
 *   - 口座番号は integer。アプリ内は文字列で、クエリは数字だけのときにだけ載せる
 *   - Dream登録状況と Dream取消状況は別の項目だが、サーバが 1 つの `Dream状況` に統合して返す
 *     （0 / 1 / 2 / 8 / 9 と、取消フェーズの C1 / C2 / C9）。画面はこの統合コードだけを見る
 *   - 売買区分は '1'（売）/ '3'（買）。アプリ内は 'buy' / 'sell'
 *   - 画面の「登録日時」列は `Dream完了日時`（取消フェーズなら取消日時）。
 *     検索の登録日（`start_date` / `end_date`）は**注文の作成日**で絞る（列の日時とは別の値）
 */

/**
 * 1 件のアプリ内モデル。
 *
 * @typedef {{
 *   id: string,
 *   status: string,
 *   statusName: string,
 *   canChangeStatus: boolean,
 *   statusTransitions: Array<{ code: string, name: string }>,
 *   receiptNumber: string,
 *   errorMessage: string,
 *   completedAt: string,
 *   branchCode: string,
 *   branchName: string,
 *   accountNumber: string,
 *   customerName: string,
 *   symbolCode: string,
 *   ticker: string,
 *   symbolName: string,
 *   side: 'buy'|'sell'|'',
 *   sideName: string,
 *   quantity: number|null,
 *   createdAt: string,
 *   updatedAt: string,
 * }} DreamOrder
 *   status は統合コード（`Dream状況`）で、statusName はサーバが付ける名前（登録失敗 など）。
 *   canChangeStatus は STS変更できる行（登録失敗 9 / 取消失敗 C9）だけ true で、
 *   statusTransitions はそのとき選べる遷移先（名前は「未登録（Dream再送待ちへ戻す）」のような説明付き）。
 *   errorMessage は Dream 連携のエラー内容（IB 由来の `エラー内容` は持たない）。
 *   completedAt は画面の「登録日時」列。未登録・登録中は空になる。
 *   updatedAt は STS変更の楽観的ロックの合札（changeDreamStatus がそのまま送り返す）
 */

/**
 * 売買区分 → アプリ内の向き。
 *
 * バックエンドのコードマスタ（`app/config/codes.json` の `売買区分`）が '1' 売 / '3' 買。
 * 知らないコードは空にする（どちらかに丸めると買いと売りを取り違える）。
 */
const SIDES = { 1: 'sell', 3: 'buy' }

/**
 * Dream 連携の対象注文を検索する。
 *
 * ページャーを持つ一覧なので `{ items, total }` を返す。並びは実 API の既定
 * （作成日時の新しい順・`sort=desc`）に任せて送らない。
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   branchCode?: string,
 *   accountNumber?: string,
 *   symbol?: string,
 *   status?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 *   receiptNumber?: string,
 * }} [params]
 *   limit は 1..200（実 API の既定は 50）。symbol は銘柄コードまたは Ticker。
 *   status は fetchDreamStatusCodes が返すコード（擬似コード ERROR を含む）。
 *   dateFrom / dateTo は 'YYYY-MM-DD'（注文の作成日）。空文字は「条件なし」としてリクエストに載せない
 * @returns {Promise<{ items: DreamOrder[], total: number }>}
 */
export async function fetchDreamOrders({
  limit = 50,
  offset = 0,
  branchCode = '',
  accountNumber = '',
  symbol = '',
  status = '',
  dateFrom = '',
  dateTo = '',
  receiptNumber = '',
} = {}) {
  const { data } = await apiClient.get('/orders/dream-status', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      limit,
      offset,
      branch_code: branchCode || undefined,
      account_no: toAccountNo(accountNumber),
      symbol: symbol || undefined,
      dream_status: status || undefined,
      start_date: dateFrom || undefined,
      end_date: dateTo || undefined,
      receipt_number: receiptNumber || undefined,
    },
  })

  return {
    items: (data?.orders ?? []).map(toDreamOrder),
    total: data?.total ?? 0,
  }
}

/**
 * Dream登録状況が「エラー」（登録失敗・取消失敗）の注文の件数（サイドメニューの Dream登録状況に添える件数）。
 *
 * 画面の Dream登録状況 を「エラー」で絞ったときの件数と同じになるよう、同じ擬似コード `ERROR` で
 * 1 件だけ引いて `total` を返す。
 *
 * @returns {Promise<number>}
 */
export async function fetchDreamErrorCount() {
  const { data } = await apiClient.get('/orders/dream-status', {
    params: { limit: 1, offset: 0, dream_status: 'ERROR' },
  })
  return data?.total ?? 0
}

/**
 * Dream状況のコード一覧（検索のプルダウン用）を取得する。
 *
 * 並びはサーバの返したまま（登録フェーズ → 取消フェーズ → 擬似コード ERROR）。
 *
 * @returns {Promise<Array<{ code: string, name: string, group: string }>>}
 *   group は '登録' / '取消' / '絞込'（ERROR だけが '絞込'）
 */
export async function fetchDreamStatusCodes() {
  const { data } = await apiClient.get('/orders/dream-status/statuses')

  return (data?.statuses ?? []).map((raw) => ({
    code: raw?.コード ?? '',
    name: raw?.名称 ?? '',
    group: raw?.区分 ?? '',
  }))
}

/**
 * 1 件の Dream状況を手動で変更する（STS変更）。
 *
 * 変えられるのは登録失敗（`9`）・取消失敗（`C9`）の行だけで、遷移先は行の statusTransitions の
 * どれか（サーバが 400 で弾く）。「登録済（`2`）」へ変えるときは、受付番号が未設定なら
 * receiptNumber が要る（無ければ 400）。
 *
 * updatedAt は一覧取得時の更新日時をそのまま送り返す楽観的ロックの合札で、
 * サーバ側の現在値と違えば 409 で弾かれる（Dream 連携のバッチや他の利用者が先に更新していた場合）。
 *
 * @param {{
 *   id: string,
 *   status: string,
 *   receiptNumber?: string,
 *   reason?: string,
 *   updatedAt: string,
 * }} params
 *   id は注文ID（実 API では integer）。status は遷移先の Dream状況コード。
 *   receiptNumber と reason は前後の空白を落とし、空なら null で送る（どちらも任意項目）
 * @returns {Promise<{ order: DreamOrder, message: string }>}
 *   order は変更後の 1 件、message はサーバの処理結果（「注文ID 56 のDream状況を…へ変更しました。」）
 */
export async function changeDreamStatus({
  id,
  status,
  receiptNumber = '',
  reason = '',
  updatedAt,
}) {
  const { data } = await apiClient.put(`/orders/dream-status/${encodeURIComponent(id)}`, {
    変更後状況: status,
    受注番号: toNullableText(receiptNumber),
    理由: toNullableText(reason),
    更新日時: updatedAt,
  })

  return {
    order: toDreamOrder(data?.order),
    message: data?.message ?? '',
  }
}

/** 任意の文字列項目 → 本文の値。前後の空白を落とし、空なら null（未指定）にする */
function toNullableText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

/**
 * 口座番号の検索条件 → クエリに載せる integer（src/api/customers.js と同じ扱い）。
 * 数字だけの入力のときにだけ送る（文字列のまま送ると 422 で弾かれる）。
 */
function toAccountNo(value) {
  const digits = String(value ?? '').trim()
  return /^\d+$/.test(digits) ? Number(digits) : undefined
}

/** DreamOrderItem → アプリ内モデル */
function toDreamOrder(raw) {
  return {
    id: String(raw?.ID ?? ''),
    status: raw?.Dream状況 ?? '',
    // nullable な項目は空文字に寄せて、画面が null を出さないようにする
    statusName: raw?.Dream状況名 ?? '',
    canChangeStatus: raw?.STS変更可 === true,
    statusTransitions: (raw?.変更可能状況 ?? []).map((transition) => ({
      code: transition?.コード ?? '',
      name: transition?.名称 ?? '',
    })),
    receiptNumber: raw?.受注番号 ?? '',
    errorMessage: raw?.Dreamエラー内容 ?? '',
    completedAt: raw?.Dream完了日時 ?? '',
    branchCode: raw?.部店 ?? '',
    branchName: raw?.部店名 ?? '',
    // 口座番号は integer で来るが、画面は桁を揃えて出すだけなので文字列に寄せる
    accountNumber: raw?.口座番号 == null ? '' : String(raw.口座番号),
    customerName: raw?.顧客名 ?? '',
    symbolCode: raw?.銘柄コード ?? '',
    ticker: raw?.Ticker ?? '',
    symbolName: raw?.銘柄名 ?? '',
    side: SIDES[raw?.売買区分] ?? '',
    sideName: raw?.売買区分名 ?? '',
    quantity: typeof raw?.数量 === 'number' ? raw.数量 : null,
    createdAt: raw?.作成日時 ?? '',
    /*
     * 楽観的ロックの合札。照合はサーバが行うので Date には通さず素の文字列で持つ
     * （src/api/symbols.js と同じ扱い）。
     */
    updatedAt: raw?.更新日時 ?? '',
  }
}

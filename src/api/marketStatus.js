import { apiClient } from './client'

/*
 * 市場状況（実 API `GET /market-status`）。全画面上部のヘッダ表示用。
 *
 * バックエンドの形を知ってよいのはこの層だけ。この API は癖が多いので、変換の責務が
 * ここに閉じていることを意識して読むこと。
 *   - プロパティ名が日本語（基準日 / 休場 / 現在のセッション …）
 *   - `US ET` は**空白を含むキー**。`raw['US ET']` でしか読めない（ドット記法が書けない）
 *   - `基準日` は integer の YYYYMMDD（20260302）。アプリ内は 'YYYY-MM-DD'
 *   - `休場理由` / `短縮取引理由` は nullable。アプリ内は空文字に寄せる
 *   - `休場: true` のとき `sessions` は空配列
 *   - `現在のセッション` は **openapi に enum 宣言が無い素の string**
 *     （PRE / REGULAR / AFTER / BEFORE_OPEN / CLOSED。docs/api/requests.md #12）。
 *     表示の主判定は JPN開始 / JPN終了 に寄せ、この文字列への依存を異常系だけに留める
 *
 * `date` クエリ（判定対象日）は実装しない。ヘッダが欲しいのは常に「いま」= m_基準日 の基準日で、
 * 使わない引数は腐るため。必要になったら引数を足す。
 *
 * この API は参照専用なので X-User-Code は要らない（付与自体は client.js が全 API 共通で行う）。
 */

/**
 * @typedef {{ code: string, name: string, nameEn: string, hoursJst: string, hoursEt: string,
 *   startJst: string, endJst: string, current: boolean }} MarketSession
 *   name は日本語の短い名（プレ / レギュラー / アフター）、nameEn は英語名。
 *   hoursJst / hoursEt は 'HH:MM - HH:MM'。**この文字列を計算に使わないこと**
 *   （レギュラーの '23:30 - 06:00' は翌日の 06:00。当日日付を足すと前倒しになる）。
 *   時刻の比較は tz 付き ISO の startJst / endJst で行う
 */

/**
 * @typedef {{ baseDate: string, nowJst: string, nowEt: string, dst: boolean,
 *   extendedPre: boolean, closed: boolean, closedReason: string, shortened: boolean,
 *   shortenedReason: string, session: string, sessionName: string, sessionNameEn: string,
 *   sessions: MarketSession[] }} MarketStatus
 *   baseDate は 'YYYY-MM-DD' の米国取引日。sessionName は日本語、sessionNameEn は英語
 */

/**
 * 市場状況を取得する。
 *
 * required の 11 項目はすべてアプリ内モデルに載せる（1 オブジェクトなので持ち回りの
 * コストが無く、落としてから足し直すほうが高くつく）。表示に使わない `extendedPre` /
 * `nowEt` も同じ理由で残してある。
 *
 * @returns {Promise<MarketStatus>}
 */
export async function fetchMarketStatus() {
  const { data } = await apiClient.get('/market-status')
  return toMarketStatus(data)
}

/** MarketStatusResponse → アプリ内モデル */
function toMarketStatus(raw) {
  return {
    baseDate: toIsoDate(raw?.基準日),
    nowJst: raw?.現在時刻_JST ?? '',
    nowEt: raw?.現在時刻_ET ?? '',
    dst: Boolean(raw?.サマータイム),
    extendedPre: Boolean(raw?.プレ拡大期間),
    closed: Boolean(raw?.休場),
    // 理由は nullable。空文字に寄せて、画面が null を出さないようにする
    closedReason: raw?.休場理由 ?? '',
    shortened: Boolean(raw?.短縮取引),
    shortenedReason: raw?.短縮取引理由 ?? '',
    session: raw?.現在のセッション ?? '',
    // 名 が英語・名称 が日本語。sessions[] の name / nameEn と向きを揃える
    sessionName: raw?.現在のセッション名称 ?? '',
    sessionNameEn: raw?.現在のセッション名 ?? '',
    // 休場の日は sessions ごと空で返る。キー自体が欠けても落とさない
    sessions: (raw?.sessions ?? []).map(toMarketSession),
  }
}

/** MarketSessionItem → アプリ内モデル */
function toMarketSession(raw) {
  return {
    code: raw?.code ?? '',
    name: raw?.名称 ?? '',
    nameEn: raw?.name ?? '',
    hoursJst: raw?.JPN ?? '',
    // 空白を含むキーなので、ここだけブラケット記法になる
    hoursEt: raw?.['US ET'] ?? '',
    startJst: raw?.JPN開始 ?? '',
    endJst: raw?.JPN終了 ?? '',
    current: Boolean(raw?.現在),
  }
}

/**
 * 20260302 → '2026-03-02'。
 *
 * Date には通さない。UTC 深夜として解釈され、UTC より西のタイムゾーンで前日にずれる。
 */
function toIsoDate(value) {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

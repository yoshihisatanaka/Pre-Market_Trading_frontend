/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * OpenAPI が確定したら、その example をこのファイルに反映する。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 画面モック（docs/mock/masters-blocked-dates/index.html）の 6 件に休業日を足して
 * 「1 年分のひな型」を 8 件にし、7 年分に展開して 8 × 7 = 56 件にしてある。
 * 移動祝日（レイバーデー / 感謝祭）の実日付は年ごとに違うため、ここでは月日を流用した近似値。
 * 実 API が実装されたら本物のデータに置き換わる。
 */
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029]

const US_MARKETS = 'NYSE/NASDAQ'
const ALL_MARKETS = '全市場'

const BLOCKED_DATES_PER_YEAR = [
  { monthDay: '01-01', market: US_MARKETS, reason: '元日（市場休場）' },
  { monthDay: '01-02', market: ALL_MARKETS, reason: '年末年始休業' },
  { monthDay: '05-04', market: ALL_MARKETS, reason: 'ゴールデンウィーク休業' },
  { monthDay: '07-04', market: US_MARKETS, reason: '米国独立記念日（市場休場）' },
  { monthDay: '08-10', market: ALL_MARKETS, reason: 'システムメンテナンス' },
  { monthDay: '09-07', market: US_MARKETS, reason: 'レイバーデー（市場休場）' },
  { monthDay: '11-26', market: US_MARKETS, reason: '感謝祭（市場休場）' },
  { monthDay: '12-25', market: US_MARKETS, reason: 'クリスマス（市場休場）' },
]

/*
 * 楽観ロック用の更新日時。実仕様（BlackoutDateRequest の 更新日時）と同じ
 * 'YYYY-MM-DD HH:MM:SS' 形式の文字列で、Date には通さない。
 * 「取得時の値をそのまま送り返して照合する合札」なので、意味のある時刻である必要はない。
 * 値は行の日付から作る（new Date() では実行ごとに変わりテストの期待値を固定できない）。
 * 日付ベースなら全件が一意になり、YEARS が伸びても一意のまま
 * = 「別の行の合札を送ると競合する」状況をテストで作れる。
 */
const UPDATED_AT_TIME = '09:00:00'

/** 日付の昇順。YEARS もひな型も昇順なので、この生成順がそのまま昇順になる */
export const blockedDates = YEARS.flatMap((year) =>
  BLOCKED_DATES_PER_YEAR.map(({ monthDay, market, reason }) => ({
    id: `bkd_${year}${monthDay.replace('-', '')}`,
    date: `${year}-${monthDay}`,
    market,
    reason,
    updated_at: `${year}-${monthDay} ${UPDATED_AT_TIME}`,
  })),
)

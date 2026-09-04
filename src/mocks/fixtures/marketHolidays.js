/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * OpenAPI が確定したら、その example をこのファイルに反映する。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 画面モックの 8 件を「1 年分のひな型」として 7 年分に展開し、8 × 7 = 56 件にしてある。
 * 移動祝日（グッドフライデー / メモリアルデー / レイバーデー / 感謝祭）の実日付は年ごとに違うため、
 * ここでは月日を流用した近似値。実 API が実装されたら本物のデータに置き換わる。
 */
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029]

const HOLIDAYS_PER_YEAR = [
  { monthDay: '01-01', reason: '元日' },
  { monthDay: '04-03', reason: 'グッドフライデー' },
  { monthDay: '05-25', reason: 'メモリアルデー' },
  { monthDay: '07-04', reason: '独立記念日' },
  { monthDay: '09-07', reason: 'レイバーデー' },
  { monthDay: '11-26', reason: '感謝祭' },
  { monthDay: '12-25', reason: 'クリスマス' },
  { monthDay: '12-26', reason: 'ボクシングデー' },
]

/** 日付の昇順。YEARS もひな型も昇順なので、この生成順がそのまま昇順になる */
export const marketHolidays = YEARS.flatMap((year) =>
  HOLIDAYS_PER_YEAR.map(({ monthDay, reason }) => ({
    id: `mhd_${year}${monthDay.replace('-', '')}`,
    date: `${year}-${monthDay}`,
    reason,
  })),
)

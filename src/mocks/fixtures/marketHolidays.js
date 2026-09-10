/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の HolidayItem に合わせてある（プロパティ名は日本語、
 * 休場日は integer の YYYYMMDD、取消区分は 0: 有効 / 1: 削除済み）。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 画面モックの 8 件を「1 年分のひな型」として 7 年分に展開し、8 × 7 = 56 件にしてある。
 * 移動祝日（グッドフライデー / メモリアルデー / レイバーデー / 感謝祭）の実日付は年ごとに違うため、
 * ここでは月日を流用した近似値。
 *
 * 休場区分は '0': 終日休場 / '1': 短縮取引（文字列。休場日と違って integer ではない）。
 * 絞り込みを検証できるよう、ボクシングデーだけ短縮取引にして偏りを付けてある（7 年分 = 7 件）。
 */
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029]

const HOLIDAYS_PER_YEAR = [
  { monthDay: '0101', reason: '元日', holidayType: '0' },
  { monthDay: '0403', reason: 'グッドフライデー', holidayType: '0' },
  { monthDay: '0525', reason: 'メモリアルデー', holidayType: '0' },
  { monthDay: '0704', reason: '独立記念日', holidayType: '0' },
  { monthDay: '0907', reason: 'レイバーデー', holidayType: '0' },
  { monthDay: '1126', reason: '感謝祭', holidayType: '0' },
  { monthDay: '1225', reason: 'クリスマス', holidayType: '0' },
  { monthDay: '1226', reason: 'ボクシングデー', holidayType: '1' },
]

/** 休場区分名はサーバが付けて返す（フロントは表示に使わず、utils の対応表を正とする） */
const HOLIDAY_TYPE_NAMES = { 0: '終日休場', 1: '短縮取引' }

function toHolidayItem({ holidayDate, reason, holidayType, canceled = false }) {
  return {
    休場日: holidayDate,
    休場区分: holidayType,
    休場区分名: HOLIDAY_TYPE_NAMES[holidayType] ?? null,
    休場理由: reason,
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: 0,
    作成日時: '2026-08-10T14:08:26',
    作成者: '702',
    更新日時: '2026-08-10T14:08:27',
    更新者: '702',
    取消日時: canceled ? '2026-08-20T09:30:00' : null,
    取消者: canceled ? '702' : null,
  }
}

/**
 * 有効な行（取消区分 0）。実 API と同じく休場日の降順。
 * YEARS もひな型も昇順なので、生成してから反転する。
 */
export const marketHolidays = YEARS.flatMap((year) =>
  HOLIDAYS_PER_YEAR.map(({ monthDay, reason, holidayType }) =>
    toHolidayItem({ holidayDate: Number(`${year}${monthDay}`), reason, holidayType }),
  ),
).reverse()

/**
 * 取消済み（論理削除）の行。既定の一覧には出ない。
 *
 * この日付で新規登録すると、実 API は「再有効化」として扱い、事前検証が warnings を返す。
 * その経路を単体テスト・E2E で通せるように 1 件だけ置いてある。
 */
export const canceledMarketHolidays = [
  toHolidayItem({
    holidayDate: 20261111,
    reason: 'ベテランズデー',
    holidayType: '0',
    canceled: true,
  }),
]

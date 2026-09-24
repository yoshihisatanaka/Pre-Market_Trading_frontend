/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 * docs/api/openapi.json の BlackoutDateItem に合わせてある（プロパティ名は日本語、
 * 受注不可日は integer の YYYYMMDD、取消区分は 0: 有効 / 1: 削除済み）。
 * 対象市場に相当する項目は実 API に無いので持たない。
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 *
 * ページャーの動作確認には 1 ページ（50 件）を超えるデータが要る。
 * 画面モック（docs/mock/masters-blocked-dates/index.html）の 6 件に休業日を足して
 * 「1 年分のひな型」を 8 件にし、7 年分に展開して 8 × 7 = 56 件にしてある。
 * 移動祝日（レイバーデー / 感謝祭）の実日付は年ごとに違うため、ここでは月日を流用した近似値。
 */
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029]

const BLACKOUT_DATES_PER_YEAR = [
  { monthDay: '0101', reason: '元日（市場休場）' },
  { monthDay: '0102', reason: '年末年始休業' },
  { monthDay: '0504', reason: 'ゴールデンウィーク休業' },
  { monthDay: '0704', reason: '米国独立記念日（市場休場）' },
  { monthDay: '0810', reason: 'システムメンテナンス' },
  { monthDay: '0907', reason: 'レイバーデー（市場休場）' },
  { monthDay: '1126', reason: '感謝祭（市場休場）' },
  { monthDay: '1225', reason: 'クリスマス（市場休場）' },
]

/*
 * 楽観ロック用の更新日時。実 API は datetime を ISO の文字列（'2026-08-10T14:08:27'）で返す。
 * 「取得時の値をそのまま送り返して照合する合札」なので、意味のある時刻である必要はない。
 * 値は行の日付から作る（new Date() では実行ごとに変わりテストの期待値を固定できない）。
 * 日付ベースなら全件が一意になり、YEARS が伸びても一意のまま
 * = 「別の行の合札を送ると競合する」状況をテストで作れる。
 */
const UPDATED_AT_TIME = 'T09:00:00'

/*
 * **`ID` だけは仕様より先行している。** 取り込み時点の openapi.json の BlackoutDateItem に
 * `ID` は無く、パスも `/masters/blackout-dates/{blackout_date}` のままだが、DB 全テーブルの
 * 主キーを id に統一する方針に合わせて先に置いてある（src/mocks/fixtures/symbols.js と同じ扱い）。
 *
 * 採番は実 API の AUTO_INCREMENT を模して単調増加させる。取消済みの行も母数に入れるので、
 * blackoutDates と canceledBlackoutDates を通して一意になる。
 */
function toBlackoutDateItem({ id, blackoutDate, reason, canceled = false }) {
  const digits = String(blackoutDate)
  const isoDate = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`

  return {
    ID: id,
    // 主キーではなくなったが、一意制約を持つ業務上の日付として残る
    受注不可日: blackoutDate,
    備考: reason,
    取消区分: canceled ? 1 : 0,
    ユーザー操作フラグ: 0,
    作成日時: '2026-08-10T14:08:26',
    作成者: '702',
    更新日時: `${isoDate}${UPDATED_AT_TIME}`,
    更新者: '702',
    取消日時: canceled ? '2026-08-20T09:30:00' : null,
    取消者: canceled ? '702' : null,
  }
}

/**
 * 有効な行（取消区分 0）。実 API と同じく受注不可日の降順。
 * YEARS もひな型も昇順なので、生成してから反転する。
 */
export const blackoutDates = YEARS.flatMap((year, yearIndex) =>
  BLACKOUT_DATES_PER_YEAR.map(({ monthDay, reason }, index) =>
    toBlackoutDateItem({
      // 受注不可日の昇順に 1..56。反転しても行に付いたまま動く
      id: yearIndex * BLACKOUT_DATES_PER_YEAR.length + index + 1,
      blackoutDate: Number(`${year}${monthDay}`),
      reason,
    }),
  ),
).reverse()

/**
 * 取消済み（論理削除）の行。既定の一覧には出ない。
 *
 * この日付で新規登録すると、実 API は行を増やさず「再有効化」する。海外休場日と違い
 * 事前検証は警告を返さず黙って通るので、その違いを単体テスト・E2E で通せるように 1 件だけ置く。
 * ひな型の 8 件と重ならない月日を選んでいる。
 */
export const canceledBlackoutDates = [
  toBlackoutDateItem({
    // 有効な行（1..56）の続き。YEARS やひな型が増えても一意のまま
    id: YEARS.length * BLACKOUT_DATES_PER_YEAR.length + 1,
    blackoutDate: 20260429,
    reason: '臨時休業（取消済み）',
    canceled: true,
  }),
]

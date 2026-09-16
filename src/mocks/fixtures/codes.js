/*
 * モックのレスポンス実体（コードマスタ）。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 *
 * `GET /codes` の応答は openapi 上 `additionalProperties: true` で中身が未定義なので、
 * 「コードマスタ名をキー、`{ code, label }` の配列を値とする object」を仮に置いている
 * （1 件の形は docs/api/openapi.json の CsvAllowedValue に合わせた）。
 * 実 API の形が判明したらここと src/api/codes.js の toOption() を直す。
 *
 * 区分系のコードと名前は AccountItem の description が正
 * （法人区分 0: 個人 / 1: 法人、口座区分 0: 一般 / 1: 自己 / 2: 同業者 など）。
 * 部店・扱者は画面モック（docs/mock/customers-holdings/index.html の部店プルダウン）の値。
 * 投資方針だけは仕様に手掛かりが無いので仮の 5 段階を置いている。
 * ステータス（CAマスタ）は実 API にまだ無いコードマスタで、コード値ごと仮置き（下記）。
 */

/**
 * 部店。顧客マスタのフィクスチャ（fixtures/customers.js）が 部店コード / 部店名 として
 * 使い回す。コードマスタと一覧の行で名前がずれないよう、出どころを 1 つにしてある。
 */
export const branches = [
  { code: '123', name: 'A支店' },
  { code: '234', name: 'B支店' },
  { code: '345', name: 'C支店' },
  { code: '456', name: 'D支店' },
]

/** 扱者。branches と同じく fixtures/customers.js が 扱者コード / 扱者名 として使い回す */
export const salesHandlers = [
  { code: '001', name: '田中' },
  { code: '002', name: '佐藤' },
  { code: '003', name: '鈴木' },
  { code: '004', name: '高橋' },
  { code: '005', name: '伊藤' },
  { code: '006', name: '渡辺' },
]

/** 取引停止区分_全取引（AccountItem では integer の 0/1 だが、コードは文字列で配る） */
export const restrictionCodes = [
  { code: '0', label: '通常' },
  { code: '1', label: '取引停止' },
]

/** 口座区分 */
export const accountTypeCodes = [
  { code: '0', label: '一般' },
  { code: '1', label: '自己' },
  { code: '2', label: '同業者' },
]

/** 法人区分 */
export const corporateTypeCodes = [
  { code: '0', label: '個人' },
  { code: '1', label: '法人' },
]

/** コンプラランク。値は ComplianceRankEnum のとおりで、名前は付いていない */
export const complianceRankCodes = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'X',
  'Y',
  'Z',
].map((code) => ({ code, label: code }))

/** 投資方針。仕様にコード表が無いので仮の 5 段階 */
export const investmentPolicyCodes = [
  { code: '1', label: '安定重視' },
  { code: '2', label: '安定成長' },
  { code: '3', label: 'バランス' },
  { code: '4', label: '成長重視' },
  { code: '5', label: '積極運用' },
]

/**
 * ステータス（CAマスタの進行状況）。**コードも名前も仮置き。**
 *
 * `GET /codes` にこのコードマスタはまだ無く、バックエンドの codes.json にも載っていない。
 * 予定 / 確定 / 完了 の 3 値は CAマスタの仕様から起こしたもので、コードは他の区分系
 * （口座区分・法人区分）と同じ 1 桁の連番に寄せた。実 API の対応表が確認できたら
 * **ここだけ**差し替える（画面と api 層はコードの中身を知らない）。
 */
export const statusCodes = [
  { code: '1', label: '予定' },
  { code: '2', label: '確定' },
  { code: '3', label: '完了' },
]

/**
 * `GET /codes` の応答そのもの。
 * 部店・扱者の label はモックのプルダウン表示（「123 A支店」）に合わせてコードを前置する。
 */
export const codeMasters = {
  部店: branches.map(({ code, name }) => ({ code, label: `${code} ${name}` })),
  扱者: salesHandlers.map(({ code, name }) => ({ code, label: `${code} ${name}` })),
  取引停止区分_全取引: restrictionCodes,
  口座区分: accountTypeCodes,
  法人区分: corporateTypeCodes,
  コンプラランク: complianceRankCodes,
  投資方針: investmentPolicyCodes,
  ステータス: statusCodes,
}

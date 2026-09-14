import { apiClient } from './client'

/*
 * コードマスタ（実 API `GET /codes`。全コードマスタ一括取得）。
 *
 * 各画面のプルダウン（部店 / 扱者 / 区分系）の選択肢はすべてここから来る。
 * 起動時に 1 回だけ読み、stores/codes.js が保持する。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 2 点。
 *   - コードマスタ名がキーの素の object（openapi では additionalProperties: true で中身が未定義）
 *   - 1 件が `{ code, label }`（openapi の CsvAllowedValue と同じ形）。
 *     アプリ内は BaseSelect の options にそのまま渡せる `{ value, label }`
 */

/**
 * コードマスタを一括で取得する。
 *
 * 未知のコードマスタ名もそのまま通す（バックエンドが増やしたものを、フロントの改修なしで
 * 受け取れるようにする）。値が配列でないものは空配列に寄せ、select が壊れないようにする。
 *
 * @returns {Promise<Record<string, Array<{ value: string, label: string }>>>}
 *   コードマスタ名（'部店' / '口座区分' など）をキーとする選択肢の辞書
 */
export async function fetchCodes() {
  const { data } = await apiClient.get('/codes')

  return Object.fromEntries(
    Object.entries(data ?? {}).map(([name, values]) => [
      name,
      (Array.isArray(values) ? values : []).map(toOption),
    ]),
  )
}

/** CsvAllowedValue（`{ code, label }`）→ BaseSelect の options が受け取る形 */
function toOption(raw) {
  return {
    // コードは数字だけのものもあるが、select の値としては常に文字列で扱う
    value: String(raw?.code ?? ''),
    label: String(raw?.label ?? ''),
  }
}

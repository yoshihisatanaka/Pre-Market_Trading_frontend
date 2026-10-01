import { apiClient } from './client'

/*
 * コードマスタ（実 API `GET /codes`。全コードマスタ一括取得）と、部店・扱者のマスタ
 * （`GET /branches` / `GET /handlers`）。
 *
 * 各画面のプルダウン（部店 / 扱者 / 区分系）の選択肢はここから来る。
 * 起動時に 1 回だけ読み、stores/codes.js が 1 つの辞書にまとめて保持する。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり。
 *   - `/codes` は `{カテゴリ: {コード: 名称}}`（openapi の CodesResponse）。
 *     アプリ内は BaseSelect の options にそのまま渡せる `{ value, label }` の配列
 *   - `投資方針` だけは法人区分で名称が変わるため `{法人区分: {コード: 名称}}` の 2 段。
 *     アプリ内は `{法人区分: 選択肢[]}`
 *   - object のキーの並びは当てにならない（JSON.parse が '101' のような整数に見えるキーを
 *     昇順で先頭へ並べ直す）。選択肢はコードの文字列順に並べ直して固定する。
 *     ゼロ埋めの桁が揃っているので、'000' < '040' < '101' と数値の順にもなる
 *   - 部店・扱者は `/codes` に無く、`{ items: [{ 部店コード, 部店名 }] }` などの別 API
 */

/**
 * @typedef {{ value: string, label: string }} CodeOption
 */

/**
 * コードマスタを一括で取得する。
 *
 * 未知のカテゴリもそのまま通す（バックエンドが増やしたものを、フロントの改修なしで
 * 受け取れるようにする）。形が崩れた値は空配列に寄せ、select が壊れないようにする。
 *
 * @returns {Promise<Record<string, CodeOption[] | Record<string, CodeOption[]>>>}
 *   カテゴリ名（'口座区分' など）をキーとする辞書。値は選択肢の配列で、
 *   2 段のカテゴリ（投資方針）だけ 1 段目のコード（法人区分）をキーとする選択肢の辞書
 */
export async function fetchCodes() {
  const { data } = await apiClient.get('/codes')

  return Object.fromEntries(
    Object.entries(isPlainObject(data) ? data : {}).map(([name, table]) => [name, toCodes(table)]),
  )
}

/**
 * 部店の選択肢を取得する。label はモックのプルダウン表示（「123 A支店」）に合わせてコードを前置する。
 *
 * @returns {Promise<CodeOption[]>} 部店コード昇順（サーバの並び）
 */
export async function fetchBranches() {
  const { data } = await apiClient.get('/branches')
  return (data?.items ?? []).map((item) =>
    toNamedOption(item?.部店コード, item?.部店名),
  )
}

/**
 * 扱者の選択肢を取得する。label は部店と同じくコードを前置する（「001 田中」）。
 *
 * 部店では絞らない（`branch_code` を送らない）。全店参照権限の無いロールは、サーバが
 * 自部店の扱者だけに自動で限定する。
 *
 * @returns {Promise<CodeOption[]>} 部店コード・扱者コード昇順（サーバの並び）
 */
export async function fetchHandlers() {
  const { data } = await apiClient.get('/handlers')
  return (data?.items ?? []).map((item) =>
    toNamedOption(item?.扱者コード, item?.扱者名),
  )
}

/** 1 カテゴリ分の値 → 選択肢の配列か、2 段のカテゴリなら選択肢の辞書 */
function toCodes(table) {
  if (!isPlainObject(table)) return []

  const entries = Object.entries(table)
  // 値が object のものが 1 つでもあれば 2 段のカテゴリ（投資方針）とみなす
  if (entries.some(([, value]) => isPlainObject(value))) {
    return Object.fromEntries(
      entries.filter(([, value]) => isPlainObject(value)).map(([key, value]) => [key, toOptions(value)]),
    )
  }
  return toOptions(table)
}

/** `{コード: 名称}` → コードの文字列順に並べた選択肢 */
function toOptions(table) {
  return Object.entries(table)
    .filter(([, label]) => typeof label === 'string')
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
}

/** 部店・扱者の 1 件 → 選択肢。名前が無ければコードだけを出す */
function toNamedOption(code, name) {
  const value = code == null ? '' : String(code)
  return { value, label: name ? `${value} ${name}` : value }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchBranches, fetchCodes, fetchHandlers } from '@/api/codes'
import { useAsync } from '@/composables/useAsync'

/**
 * コードマスタ・部店・扱者を 1 つの辞書にまとめて取得する。
 *
 * 部店・扱者は `/codes` に無い（`/branches` / `/handlers`）が、画面からは区分と同じく
 * `optionsFor('部店')` で引けるようにする。3 本のどれかが失敗したら全体を失敗にする
 * （起動時の覆いが理由を出し、「再試行」で 3 本とも読み直す）。
 */
async function fetchAllCodes() {
  const [codes, branches, handlers] = await Promise.all([
    fetchCodes(),
    fetchBranches(),
    fetchHandlers(),
  ])
  return { ...codes, 部店: branches, 扱者: handlers }
}

/**
 * コードマスタのストア。全画面のプルダウンの選択肢をここから配る。
 *
 * 中身は画面ごとに変わらないので、一覧のストアと違って検索条件もページ位置も持たない。
 * 読み込みは main.js が起動時に 1 回だけ行い、画面は optionsFor() で読むだけにする
 * （画面ごとに load を呼ぶと、画面を開くたびに同じ API を叩くことになる）。
 *
 * App.vue は ready が立つまで画面（RouterView）を描かない。したがって画面の setup の時点で
 * 選択肢は必ず揃っていて、URL クエリの値を選択肢で検査するような同期の読み方をしてよい。
 *
 * 1 件の形は src/api/codes.js の JSDoc を参照。
 */
export const useCodesStore = defineStore('codes', () => {
  const { data, error, loading, execute } = useAsync(fetchAllCodes, { initialData: {} })

  /** 一度でも取得に成功したか（起動時に失敗し、「再試行」で成功したときに初めて立つこともある） */
  const ready = ref(false)

  async function load() {
    await execute()
    if (!error.value) ready.value = true
  }

  /**
   * コードマスタ名に対応する選択肢。
   *
   * 未取得（起動直後）でも未知の名前でも空配列を返す。画面側は読み込みの完了を待たずに
   * select を描いてよく、取得が終われば computed 経由で自動的に選択肢が埋まる。
   *
   * 2 段のカテゴリ（投資方針）は context（法人区分のコード）で 1 段目を選ぶ。
   * context が無い・未知のときは空配列になる（どちらの名称を出すか決められないため）。
   *
   * @param {string} name コードマスタ名（'部店' / '口座区分' / '投資方針' など）
   * @param {string} [context] 2 段のカテゴリの 1 段目のコード（投資方針なら法人区分）
   * @returns {Array<{ value: string, label: string }>}
   */
  function optionsFor(name, context) {
    const entry = data.value?.[name]
    if (Array.isArray(entry)) return entry
    if (entry && context != null) return entry[String(context)] ?? []
    return []
  }

  /**
   * 画面が決めた並び・絞り込みでの選択肢。名称はコードマスタから引く。
   *
   * コードマスタの並びはコード順だが、画面モックの並び（買 → 売 など。#42 の回答でフロント固定）や
   * 「その画面で選べる値」の絞り込み（NISA を出さない など。#73）は画面が決める。
   * コードマスタに無いコードは落とす（名称の無い選択肢を出さない）。
   *
   * @param {string} name コードマスタ名
   * @param {string[]} codes 並べたいコードの列
   * @returns {Array<{ value: string, label: string }>}
   */
  function pickOptions(name, codes) {
    const options = optionsFor(name)
    return codes
      .map((code) => options.find((option) => option.value === code))
      .filter(Boolean)
  }

  /**
   * コード → 名称。確認画面の読み上げや、一覧セルで名称が来ないときの補いに使う。
   *
   * @param {string} name コードマスタ名
   * @param {string|null|undefined} code
   * @returns {string} 名称。未知の値・空値は '—'（他の列の空値表現とそろえる）
   */
  function labelFor(name, code) {
    return optionsFor(name).find((option) => option.value === code)?.label ?? '—'
  }

  /**
   * コードマスタにあるコードか。URL クエリのような外から来る値を検索条件に使う前に通す。
   *
   * @param {string} name コードマスタ名
   * @param {unknown} code
   * @returns {boolean}
   */
  function hasCode(name, code) {
    return optionsFor(name).some((option) => option.value === code)
  }

  return {
    codes: data,
    error,
    loading,
    ready,
    load,
    optionsFor,
    pickOptions,
    labelFor,
    hasCode,
  }
})

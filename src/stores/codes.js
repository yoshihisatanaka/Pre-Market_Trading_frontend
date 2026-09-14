import { defineStore } from 'pinia'
import { fetchCodes } from '@/api/codes'
import { useAsync } from '@/composables/useAsync'

/**
 * コードマスタのストア。全画面のプルダウンの選択肢をここから配る。
 *
 * 中身は画面ごとに変わらないので、一覧のストアと違って検索条件もページ位置も持たない。
 * 読み込みは main.js が起動時に 1 回だけ行い、画面は optionsFor() で読むだけにする
 * （画面ごとに load を呼ぶと、画面を開くたびに同じ API を叩くことになる）。
 *
 * 1 件の形は src/api/codes.js の JSDoc を参照。
 */
export const useCodesStore = defineStore('codes', () => {
  const { data, error, loading, execute } = useAsync(fetchCodes, { initialData: {} })

  /**
   * コードマスタ名に対応する選択肢。
   *
   * 未取得（起動直後）でも未知の名前でも空配列を返す。画面側は読み込みの完了を待たずに
   * select を描いてよく、取得が終われば computed 経由で自動的に選択肢が埋まる。
   *
   * @param {string} name コードマスタ名（'部店' / '口座区分' など）
   * @returns {Array<{ value: string, label: string }>}
   */
  function optionsFor(name) {
    return data.value?.[name] ?? []
  }

  return {
    codes: data,
    error,
    loading,
    load: execute,
    optionsFor,
  }
})

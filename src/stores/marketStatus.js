import { defineStore } from 'pinia'
import { fetchMarketStatus } from '@/api/marketStatus'
import { useAsync } from '@/composables/useAsync'

/**
 * 市場状況（全画面共通のヘッダが出す取引セッションと時間帯）。
 *
 * 検索条件もページングも無い単一リソースなので、一覧系の useCrudList ではなく
 * useAsync を直に使う（usePermissionsStore と同じ形）。
 *
 * **ヘッダから直に API を呼ばずストアを挟んでいる理由は 3 つある。**
 *   - main.js で useCodesStore の隣に先読みでき、起動オーバーレイが覆っている間に取得が終わる
 *     （ヘッダがマウントされた瞬間に「—」が見えるちらつきが出ない）
 *   - 休場 / 短縮取引は将来 発注画面も欲しがる（全画面共通・起動時 1 回という点で codes と同じ）
 *   - HTTP がコンポーネントの外に出るので、**ヘッダのマウント自体が通信を起こさない**
 *
 * **取得は起動時の 1 回だけ**（main.js）。以後の表示の切り替えは、composables/useMarketStatus が
 * sessions の境界で行う。例外は受注不可日 / 海外休場日マスタの保存で、そのときだけ
 * reloadMarketStatusAfter が取り直す。
 *
 * **タイマーはここに置かない。** ストアは unmount されないのでタイマーが永久に残る。
 * 境界の切り替えは composables/useMarketStatus が onMounted / onUnmounted で持つ。
 *
 * 取得に失敗しても status は前の値のまま残す（useAsync が data を書き換えないため）。
 * 画面を開いたまま一時的に通信が切れたときに、直前まで出ていた時間帯を消さないための挙動。
 */
export const useMarketStatusStore = defineStore('marketStatus', () => {
  const { data, error, loading, execute } = useAsync(fetchMarketStatus)

  function load() {
    return execute()
  }

  // data のままだと呼び出し側が何のデータか分からないので status で公開する
  return { status: data, error, loading, load }
})

/**
 * api 層の書き込み関数を包み、成功したら市場状況を取り直す。
 *
 * 受注不可日 / 海外休場日マスタで当日を短縮営業や休場に変えると、起動時に取った市場状況と
 * 実際の市場日時が食い違う。そのマスタの登録・更新・削除にだけ被せて、ヘッダを追随させる。
 *
 * 取り直しは **await しない**。マスタの保存の成否と完了を市場状況の取得に引きずらせないため。
 * 取り直しに失敗しても status は前の値のまま残る（useAsync が書き換えない）。
 * 書き込みが例外を投げたら取り直さず、その例外をそのまま呼び出し側（useCrudList）へ返す。
 *
 * @template {(arg: any) => Promise<any>} T
 * @param {T} write
 * @returns {T}
 */
export function reloadMarketStatusAfter(write) {
  return async (...args) => {
    const result = await write(...args)
    useMarketStatusStore().load()
    return result
  }
}

import { computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toOffset } from '@/utils/queryParams'

/**
 * 一覧画面の「ページ位置と検索条件は URL クエリを正とする単方向フロー」を共通化する。
 *
 *   操作（検索 / ページ移動） → router.push({ query })  ← ここでは読み込まない
 *                                    ↓
 *                          route.query が変わる
 *                                    ↓
 *              watch(queryKey, immediate) → load(params)
 *
 * こうすると二重フェッチが起きず、ブラウザバック / フォワードやブックマークにも
 * 追加のコードなしで対応できる。呼び出し側は onMounted での初回読み込みを書かない
 * （immediate が担う）。
 *
 * 崩してはいけない約束が 3 つある。
 *   1. この関数は setup 中に同期で呼ぶ。watch の登録が onMounted へ遅れると、
 *      初回描画がローディングにならない
 *   2. inputs を watch して URL へ push しない。URL → inputs の単方向だけにする。
 *      双方向にすると submitSearch と競合して二重フェッチ・無限ループになる
 *   3. queryKey は文字列に畳んだ computed のままにする。route.query は
 *      ナビゲーションごとに参照が変わるので、オブジェクトのまま監視できない
 *
 * クエリ名（`date_from` など）は URL 上の契約であってバックエンドのモデル表現ではない。
 * snake_case は filters の `query` にだけ現れ、この関数の外へ漏れない。
 *
 * @param {{
 *   filters?: Array<{
 *     key: string,
 *     query: string,
 *     parse?: (value: unknown) => string,
 *   }>,
 *   load: (params: Record<string, string|number>) => unknown,
 * }} options
 *   filters の `key` はアプリ内モデル側の名前（camelCase）で、`inputs` のキーと
 *   `load` に渡す params のキーになる。`query` は URL 上の名前。
 *   `parse` は手で書き換えられたクエリを正規化する（既定は文字列以外を空文字にするだけ）。
 *   `load` は store の load をそのまま渡す。params には常に `offset` が含まれる。
 * @returns {{
 *   inputs: Record<string, string>,
 *   submitSearch: () => void,
 *   clearSearch: () => void,
 *   goToOffset: (offset: number) => void,
 * }}
 *   inputs は reactive オブジェクト。テンプレートからは `v-model="inputs.dateFrom"` で使う
 */
export function useListQuery({ filters = [], load }) {
  const route = useRoute()
  const router = useRouter()

  function paramsFromQuery(query) {
    const params = { offset: toOffset(query.offset) }
    for (const { key, query: name, parse } of filters) {
      const raw = query[name]
      params[key] = parse ? parse(raw) : typeof raw === 'string' ? raw : ''
    }
    return params
  }

  function queryFromParams(params) {
    // 既定値はクエリに出さず URL を短く保つ
    const query = {}
    if (params.offset > 0) query.offset = String(params.offset)
    for (const { key, query: name } of filters) {
      if (params[key]) query[name] = params[key]
    }
    return query
  }

  // 検索フォームの入力値。URL に反映されるのは submitSearch を呼んだときだけ
  const inputs = reactive(Object.fromEntries(filters.map(({ key }) => [key, ''])))

  const queryKey = computed(() => {
    const params = paramsFromQuery(route.query)
    return [params.offset, ...filters.map(({ key }) => params[key])].join('|')
  })

  watch(
    queryKey,
    () => {
      const params = paramsFromQuery(route.query)
      // ブラウザバックでも入力欄が URL に追従するようにする
      for (const { key } of filters) {
        inputs[key] = params[key]
      }
      load(params)
    },
    { immediate: true },
  )

  /** 入力欄の内容で検索する。条件を変えたら 1 ページ目に戻す */
  function submitSearch() {
    router.push({ query: queryFromParams({ ...inputs, offset: 0 }) })
  }

  /** 検索条件とページ位置をすべて捨てる */
  function clearSearch() {
    router.push({ query: {} })
  }

  /**
   * ページを移動する。
   *
   * 検索条件は入力欄ではなく URL（= いま読み込まれている条件）から取る。
   * 入力欄を編集しただけでページ送りしたときに、条件が中途半端に混ざらないようにするため。
   */
  function goToOffset(offset) {
    router.push({ query: queryFromParams({ ...paramsFromQuery(route.query), offset }) })
  }

  return { inputs, submitSearch, clearSearch, goToOffset }
}

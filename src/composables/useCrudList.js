import { computed, ref } from 'vue'
import { useAsync } from '@/composables/useAsync'

/**
 * ページャー付きマスタ一覧の足回り（取得・競合防止・新規追加・編集・削除）を共通化する。
 *
 * Pinia の setup ストアの中から呼び、返り値をそのままストアの公開 API にする。
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 *
 * loading / error は操作ごとに分かれている。一覧・登録・更新・削除で別々の useAsync を持つのは、
 * 登録中や削除中も一覧の表示をそのまま残したいため。
 *
 * @param {{
 *   pageSize: number,
 *   filterKeys?: string[],
 *   fetchPage: (params: object) => Promise<{ items: object[], total: number }>,
 *   createItem: (payload: object) => Promise<object>,
 *   validateItem?: (payload: object) =>
 *     Promise<{ valid: boolean, errors: string[], warnings?: string[] }>,
 *   updateItem?: (payload: object) => Promise<object>,
 *   deleteItem: (id: string) => Promise<unknown>,
 * }} options
 *   filterKeys は検索条件の名前。同名の ref をそのまま公開する（画面が storeToRefs で読む）。
 *
 *   validateItem は「登録・更新の前にサーバの事前検証を通す」API を持つ一覧だけ渡す。
 *   **不合格を例外で表してはいけない**（`{ valid: false, errors }` を返す）。
 *   throw は通信・サーバ障害として createError / updateError に入り、
 *   事前検証の不合格とは扱いが違う。
 *
 *   warnings は「登録できるが、そのまま通してよいか確かめたいこと」（例: 取消済みの日付を
 *   再有効化する）。登録側だけが扱い、1 回目は登録せず validationWarnings に入れて戻る。
 *   利用者が承知して押し直すとき、画面は payload に `acknowledgedWarnings: true` を足す。
 *   更新側は warnings を扱わない（warnings を返す事前検証を持つ編集画面がまだ無い）。
 *
 *   updateItem は行ごとの編集を持つ一覧だけ渡す。渡さない一覧には更新系の名前を公開しない。
 * @returns {object}
 *   items / total / limit / offset / filterKeys の各 ref /
 *   loading / error / isEmpty / load / reload /
 *   creating / createError / validationErrors / validationWarnings / create / clearCreateError /
 *   deleting / deleteError / remove / clearDeleteError。
 *   updateItem を渡した場合はさらに
 *   updating / updateError / updateValidationErrors / update / clearUpdateError。
 *   validationErrors / validationWarnings は validateItem を渡さない場合は常に空配列。
 *   1 件の形は各 src/api/*.js の JSDoc を参照。
 */
export function useCrudList({
  pageSize,
  filterKeys = [],
  fetchPage,
  createItem,
  validateItem,
  updateItem,
  deleteItem,
}) {
  // ページャー連打やブラウザバック連打で、古い応答が新しい結果を上書きするのを防ぐ。
  // useCrudList の呼び出しごと（= ストアごと）に独立させたいので、
  // モジュールスコープではなくこのクロージャに置く
  let latestToken = 0
  async function fetchLatest(params) {
    const token = ++latestToken
    const result = await fetchPage(params)
    return token === latestToken ? result : data.value
  }

  const { data, error, loading, execute } = useAsync(fetchLatest, {
    initialData: { items: [], total: 0 },
  })

  // storeToRefs で取り出せるよう、定数も ref で持つ
  const limit = ref(pageSize)
  const offset = ref(0)
  const filters = Object.fromEntries(filterKeys.map((key) => [key, ref('')]))

  const items = computed(() => data.value?.items ?? [])
  const total = computed(() => data.value?.total ?? 0)
  const isEmpty = computed(() => !loading.value && !error.value && items.value.length === 0)

  /**
   * 検索条件とページ位置を指定して読み込む。
   * 呼ぶのは URL クエリを監視している画面側の watcher（useListQuery）だけ。
   */
  function load({ offset: nextOffset = 0, ...rest } = {}) {
    offset.value = nextOffset
    for (const key of filterKeys) {
      filters[key].value = rest[key] ?? ''
    }

    return execute({ limit: limit.value, offset: nextOffset, ...currentFilters() })
  }

  /** いまの条件のまま読み直す（再読み込み / 再試行ボタン用。URL は変えない） */
  function reload() {
    return load({ offset: offset.value, ...currentFilters() })
  }

  function currentFilters() {
    return Object.fromEntries(filterKeys.map((key) => [key, filters[key].value]))
  }

  /*
   * 登録。validateItem がある場合は「事前検証 → 登録」の 2 段になるが、
   * 2 段をまたぐ 1 つの操作として扱いたいので useAsync は 1 本にまとめる。
   * 検証で弾かれた場合は例外にせず { valid: false, errors } を返す。
   */
  async function validateThenCreate(payload) {
    if (validateItem) {
      const validation = await validateItem(payload)
      if (!validation.valid) return { valid: false, errors: validation.errors }

      /*
       * 警告付きの合格。登録はできるが、黙って通すと利用者の意図と違う結果になりうるので
       * （取消済みの日付の再有効化など）、1 回目は登録せずに理由だけ返す。
       * 承知したうえで押し直すと payload に acknowledgedWarnings が付いて、ここを素通りする。
       */
      const warnings = validation.warnings ?? []
      if (warnings.length > 0 && !payload.acknowledgedWarnings) {
        return { valid: true, warnings }
      }
    }

    const created = await createItem(payload)
    return { valid: true, created }
  }

  const {
    error: createError,
    loading: creating,
    execute: executeCreate,
  } = useAsync(validateThenCreate)

  // サーバの事前検証が返した理由（通信自体は成功しているので createError とは別に持つ）
  const validationErrors = ref([])

  // 事前検証が返した警告。登録できない理由ではないので errors とは別に持つ
  const validationWarnings = ref([])

  /**
   * 1 件登録し、成功したら今の条件のまま一覧を読み直す。
   *
   * @param {object} payload api 層の createItem / validateItem へそのまま渡る。
   *   警告を承知して押し直すときは `acknowledgedWarnings: true` を含める
   * @returns {Promise<object|null>} 登録された 1 件。登録しなかったときは null
   *   （通信・サーバエラーは createError、事前検証で弾かれた理由は validationErrors、
   *   確認待ちの警告は validationWarnings に入る）
   */
  async function create(payload) {
    validationErrors.value = []
    validationWarnings.value = []

    const result = await executeCreate(payload)
    // 通信・サーバエラー（理由は createError）
    if (!result) return null

    if (!result.valid) {
      validationErrors.value = result.errors
      return null
    }

    // 警告付きの合格。まだ登録していないので、確認してもらうために理由を残して戻る
    if (!result.created) {
      validationWarnings.value = result.warnings
      return null
    }

    await reload()
    return result.created
  }

  /** 登録の失敗理由を消す（モーダルを開き直したときに前回の失敗を残さない） */
  function clearCreateError() {
    createError.value = null
    validationErrors.value = []
    validationWarnings.value = []
  }

  /*
   * 更新。登録と同じく「事前検証 → 更新」を 1 本の useAsync にまとめる。
   * 検証には対象の id も渡す（更新では自分自身を重複と見なさないため、サーバに対象を伝える）。
   */
  async function validateThenUpdate(payload) {
    if (validateItem) {
      const validation = await validateItem(payload)
      if (!validation.valid) return { valid: false, errors: validation.errors }
    }

    const updated = await updateItem(payload)
    return { valid: true, updated }
  }

  const {
    error: updateError,
    loading: updating,
    execute: executeUpdate,
  } = useAsync(validateThenUpdate)

  /*
   * 更新の事前検証が返した理由。登録側の validationErrors とは共用しない。
   * 共用すると「編集モーダルを開くときに登録の失敗も消す」義務が互いに生まれ、
   * 片方を消し忘れると他方のモーダルに前回の理由が漏れる。
   * 名前が validationErrors / updateValidationErrors と非対称なのは、
   * 既存の validationErrors を改名するとシナリオ文書とテストに広く波及するため。
   */
  const updateValidationErrors = ref([])

  /**
   * 1 件更新し、成功したら今の条件のまま一覧を読み直す。
   *
   * @param {object} payload api 層の updateItem / validateItem へそのまま渡る
   *   （id と、楽観的ロックを持つ一覧では取得時の更新日時を含む）
   * @returns {Promise<object|null>} 更新後の 1 件。失敗時は null
   *   （通信・サーバエラーは updateError、事前検証で弾かれた理由は updateValidationErrors に入る）
   *   削除の true / false と違い実体を返すのは、成功メッセージに使う日付が
   *   「サーバが受理した日付」であるべきなため（日付を変更できる）
   */
  async function update(payload) {
    updateValidationErrors.value = []

    const result = await executeUpdate(payload)
    // 通信・サーバエラー（理由は updateError。楽観的ロックの競合 409 もここに入る）
    if (!result) return null

    if (!result.valid) {
      updateValidationErrors.value = result.errors
      return null
    }

    await reload()
    return result.updated
  }

  /** 更新の失敗理由を消す（モーダルを開き直したときに前回の失敗を残さない） */
  function clearUpdateError() {
    updateError.value = null
    updateValidationErrors.value = []
  }

  const { error: deleteError, loading: deleting, execute: executeDelete } = useAsync(deleteItem)

  /**
   * 1 件削除し、成功したら今の条件のまま一覧を読み直す。
   *
   * @param {string} id 削除対象の id
   * @returns {Promise<boolean>} 削除できたら true（失敗の理由は deleteError に入る）
   */
  async function remove(id) {
    const deleted = await executeDelete(id)
    if (!deleted) return false

    await reload()
    return true
  }

  /** 削除エラーを消す（確認モーダルを開き直したときに前回の失敗を残さない） */
  function clearDeleteError() {
    deleteError.value = null
  }

  return {
    items,
    total,
    limit,
    offset,
    ...filters,
    error,
    loading,
    isEmpty,
    load,
    reload,
    creating,
    createError,
    validationErrors,
    validationWarnings,
    create,
    clearCreateError,
    // 更新は updateItem を渡した一覧だけが持つ。渡していない一覧で store.update() を
    // 呼んだら「関数が無い」で落ちるようにしたいので、キーごと出さない
    ...(updateItem
      ? { updating, updateError, updateValidationErrors, update, clearUpdateError }
      : {}),
    deleting,
    deleteError,
    remove,
    clearDeleteError,
  }
}

import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchCustomers } from '@/api/customers'
import { useAsync } from '@/composables/useAsync'
import { joinWide } from '@/utils/format'

/**
 * 顧客の選択肢を配るストア。残高マスタの「新規保有を追加」の対象顧客プルダウンが使う。
 *
 * **顧客マスタのストア（src/stores/customers.js）とは別に持つ。** あちらは useCrudList 版の
 * ページ付き一覧ストアで、offset と検索条件を握っている。Pinia のインスタンスは全画面で
 * 共有されるので、ここから load() を呼ぶと顧客マスタ画面のページ位置と条件を踏み潰す。
 * 役割としては codes.js（選択肢を配るだけ）に近い。
 *
 * ただし読み込みは main.js ではなく、使う画面の onMounted から loadOnce() する。
 * この選択肢が要るのは残高マスタだけなので、起動時に全画面ぶん取りに行く理由が無い。
 *
 * **顧客が 200 件を超えると選択肢が欠ける。** 実 API の limit の上限が 200 で、
 * プルダウンという形自体がその規模で成り立たない。超える運用になったら
 * 「口座番号を入力してサーバに引かせる」形へ作り替える（→ バックエンドへの確認事項）。
 */
export const CUSTOMER_OPTIONS_LIMIT = 200

export const useCustomerOptionsStore = defineStore('customerOptions', () => {
  const { data, error, loading, execute } = useAsync(fetchCustomers, {
    initialData: { items: [], total: 0 },
  })

  const items = computed(() => data.value?.items ?? [])

  /**
   * BaseSelect に渡す選択肢。画面モックの `123 / 123456 中村 凪` 形式。
   *
   * value を `部店コード-口座番号` の複合キーにしてあるのは、口座番号が部店をまたいで
   * 一意である保証が仕様に無いため。findByValue() で元の顧客に引き戻す。
   */
  const options = computed(() =>
    items.value.map((customer) => ({
      value: toOptionValue(customer),
      label: joinWide(`${customer.branchCode} / ${customer.accountNumber}`, customer.customerName),
    })),
  )

  /**
   * 1 度だけ読み込む（すでに読めていれば何もしない）。
   * 画面を開き直すたびに同じ API を叩かないための入口。
   *
   * 失敗したときは items が空のままなので、次に開いたときは取り直す。
   */
  function loadOnce() {
    if (items.value.length > 0 || loading.value) return null
    return execute({ limit: CUSTOMER_OPTIONS_LIMIT })
  }

  /**
   * 選択肢の value から顧客 1 件を引く。
   *
   * @param {string} value options[].value
   * @returns {object|null} src/api/customers.js の Customer。見つからなければ null
   */
  function findByValue(value) {
    return items.value.find((customer) => toOptionValue(customer) === value) ?? null
  }

  return {
    customers: items,
    options,
    error,
    loading,
    loadOnce,
    findByValue,
  }
})

/** 顧客 → 選択肢の value（部店コードと口座番号の複合キー） */
function toOptionValue(customer) {
  return `${customer.branchCode}-${customer.accountNumber}`
}

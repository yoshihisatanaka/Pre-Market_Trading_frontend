import { defineStore } from 'pinia'
import { fetchCustomers } from '@/api/customers'
import { fetchHoldings } from '@/api/holdings'
import { useAsync } from '@/composables/useAsync'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /holdings`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const HOLDING_SEARCH_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 顧客を引くときに読む件数。部店と口座番号で 1 件に絞れるはずだが、
 * 部店の無い明細（部店コード null）でも口座番号の完全一致を手元で選び直せるよう、少し多めに読む
 * （stores/orderEntry.js の照会と同じ考え方）。
 */
const CUSTOMER_LOOKUP_LIMIT = 10

/**
 * 預り検索（サイドメニューの /customers/holdings）のストア。
 *
 * 読む API は顧客詳細の外株預りと同じ `fetchHoldings`（src/api/holdings.js）。
 * **ストアは顧客詳細（stores/customerDetail.js）と分ける。** あちらは 1 顧客ぶんの預りを持つので、
 * 同じストアにするとこちらの検索が顧客詳細の預りを踏み潰す（stores/customerSearch.js と同じ理由）。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * **一覧は読むだけ**なので createItem / updateItem / deleteItem は渡さない。
 *
 * もう 1 つ、顧客名・買い / 売りから顧客詳細へ移るための「顧客マスタの行 ID を得る」（openCustomer）を持つ。
 * 顧客詳細のルート（/customers/:customerId/summary）は顧客マスタの行 ID で顧客を指す。
 * `HoldingItem` は 口座ID（= その行 ID。docs/api/requests.md #36 ⑦）を返すので、明細にあればそれをそのまま使い、
 * 通信しない。口座ID の無い明細（Phase 66 より前のバックエンド・顧客マスタに無い口座）のときだけ、
 * `GET /masters/customers` を部店コード・口座番号で引いて ID を得る。
 */
export const useHoldingSearchStore = defineStore('holdingSearch', () => {
  const list = useCrudList({
    pageSize: HOLDING_SEARCH_PAGE_SIZE,
    filterKeys: [
      'branchCode',
      'accountNumber',
      'customerName',
      'symbol',
      'symbolName',
      'specificDeposit',
    ],
    fetchPage: fetchHoldings,
  })

  async function findCustomerId({ branchCode, accountNumber }) {
    const { items } = await fetchCustomers({
      branchCode,
      accountNumber,
      limit: CUSTOMER_LOOKUP_LIMIT,
    })
    const customer = items.find(
      (item) =>
        item.accountNumber === accountNumber && (!branchCode || item.branchCode === branchCode),
    )
    // 見つからないのは通信の失敗ではないが、移る先が無いので理由として出す（例外にして error に入れる）
    if (!customer?.id) {
      throw new Error(`口座番号 ${accountNumber} の顧客が顧客マスタに見つかりません。`)
    }
    return customer.id
  }

  const {
    error: customerLookupError,
    loading: customerLookupPending,
    execute: executeCustomerLookup,
  } = useAsync(findCustomerId)

  /**
   * 預りの 1 明細から、その顧客の顧客マスタの行 ID を得る。明細に customerId があれば引かずに返す。
   *
   * @param {{ customerId?: string, branchCode: string, accountNumber: string }} holding
   *   src/api/holdings.js の Holding
   * @returns {Promise<string|null>} 行 ID。引けなかったときは null（理由は customerLookupError）
   */
  async function openCustomer({ customerId = '', branchCode, accountNumber }) {
    if (customerId) {
      customerLookupError.value = null
      return customerId
    }
    return executeCustomerLookup({ branchCode, accountNumber })
  }

  /** 顧客を引けなかった理由を消す（検索し直したときに前回の失敗を残さない） */
  function clearCustomerLookupError() {
    customerLookupError.value = null
  }

  return {
    ...list,
    customerLookupError,
    customerLookupPending,
    openCustomer,
    clearCustomerLookupError,
  }
})

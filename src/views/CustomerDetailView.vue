<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import CustomerInfoBar from '@/components/customers/CustomerInfoBar.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import { useCustomerDetailStore } from '@/stores/customerDetail'
import { buildOrderEntryQuery } from '@/utils/orderEntryQuery'

/*
 * 顧客詳細の枠（画面モック customer_summary.html / customer_order_inquiry.html の共通部分）。
 * 顧客カードとタブを持ち、タブの中身は子ルートが描く（router/index.js の children）。
 *   外株預り … /customers/:customerId/summary（views/CustomerSummaryView.vue）
 *   注文照会 … /customers/:customerId/orders（views/CustomerOrdersView.vue）
 *   注文入力 … 新規注文（/orders/new）へ部店と口座番号を引き継いで移る（タブの中には描かない。モックと同じ）
 *
 * 顧客はこの枠が 1 回だけ読む。タブを切り替えても枠は残るので読み直さない。
 * 子ルートは顧客を読み終えてから描く（注文照会タブは顧客の部店と口座番号で絞るため）。
 *
 * 画面モックの 4 つめのタブ「仮計算」（/calculations）は未実装なので置かない。
 * 作るときはここに 1 つ足す（docs/progress.md の「顧客詳細 / 仮計算タブ」）。
 */

const route = useRoute()

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCustomerDetailStore()
const { customer, customerError, customerNotFound, valuation } = storeToRefs(store)

const customerId = computed(() => String(route.params.customerId ?? ''))

/*
 * 初回と、URL を書き換えて別の顧客へ移ったときに読む（タブの切り替えでは customerId が変わらない）。
 * 空は顧客詳細の外へ移る途中（この画面が外れる直前に route が先に変わる）なので読まない。
 */
watch(
  customerId,
  (id) => {
    if (id) store.load(id)
  },
  { immediate: true },
)

/*
 * 読み込み中の表示は、顧客をまだ持っていないときだけ出す。同じ顧客を開き直したときは
 * 前回の顧客カードを出したまま裏で読み直す（stores/customerDetail.js の load）。
 * customerLoading では判定しない。別の顧客へ続けて移ると、古い読み込みが先に終わった時点で
 * loading が false に戻り、新しい顧客を読み終えるまで何も出ない瞬間ができるため。
 */
const showLoading = computed(() => !customer.value && !customerError.value)

const tabs = computed(() => [
  {
    key: 'summary',
    label: '外株預り',
    to: { name: 'customer-summary', params: { customerId: customerId.value } },
  },
  {
    key: 'order-entry',
    label: '注文入力',
    to: {
      name: 'order-new',
      query: buildOrderEntryQuery({
        branchCode: customer.value?.branchCode,
        accountNumber: customer.value?.accountNumber,
      }),
    },
  },
  {
    key: 'orders',
    label: '注文照会',
    to: { name: 'customer-orders', params: { customerId: customerId.value } },
  },
])

function reload() {
  store.load(customerId.value)
}
</script>

<template>
  <section class="customer-detail">
    <!-- ローディング / エラー / 空（顧客が見つからない）/ データあり の 4 状態 -->
    <p
      v-if="showLoading"
      data-testid="customer-detail-loading"
      class="customer-detail__status is-loading"
    >
      <BaseSpinner />
    </p>

    <div
      v-else-if="customerNotFound"
      data-testid="customer-detail-not-found"
      class="customer-detail__status"
    >
      <p>該当する顧客が見つかりません。</p>
      <RouterLink :to="{ name: 'customer-search' }" data-testid="customer-detail-back-to-search">
        顧客検索へ戻る
      </RouterLink>
    </div>

    <div
      v-else-if="customerError"
      data-testid="customer-detail-error"
      class="customer-detail__status is-error"
    >
      <p>{{ customerError.message }}</p>
      <BaseButton variant="secondary" data-testid="customer-detail-retry" @click="reload">
        再試行
      </BaseButton>
    </div>

    <template v-else-if="customer">
      <CustomerInfoBar :customer="customer" :valuation="valuation" />

      <nav class="customer-detail__tabs" aria-label="顧客詳細" data-testid="customer-detail-tabs">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.key"
          :to="tab.to"
          class="customer-detail__tab"
          active-class="is-active"
          :data-testid="`customer-detail-tab-${tab.key}`"
        >
          {{ tab.label }}
        </RouterLink>
      </nav>

      <RouterView />
    </template>
  </section>
</template>

<style scoped>
.customer-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* タブ。下線で選択中を示す（モックの .tab-bar / .tab-item） */
.customer-detail__tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
}

.customer-detail__tab {
  margin-bottom: -1px;
  padding: var(--space-2) var(--space-4);
  border-bottom: 3px solid transparent;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  font-weight: 500;
  text-decoration: none;
}

.customer-detail__tab:hover {
  background-color: var(--color-surface-muted);
  color: var(--color-text-heading);
}

.customer-detail__tab.is-active {
  border-bottom-color: var(--color-primary);
  background-color: var(--color-surface-muted);
  color: var(--color-primary);
  font-weight: 700;
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ（新規注文の画面と同じ） */
.customer-detail__status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.customer-detail__status p {
  margin: 0;
}

.customer-detail__status.is-error {
  flex-direction: row;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>

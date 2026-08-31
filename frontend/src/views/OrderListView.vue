<script setup>
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import BaseButton from '@/components/ui/BaseButton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useOrdersStore } from '@/stores/orders'
import { formatDateTime, formatQuantity, formatUsd } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrdersStore()
const { items, loading, error, isEmpty } = storeToRefs(store)

const columns = [
  { key: 'symbol', label: 'ティッカー' },
  { key: 'name', label: '銘柄名' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'price', label: '価格', numeric: true },
  { key: 'status', label: 'ステータス' },
  { key: 'orderedAt', label: '注文日時' },
]

const sideLabels = { buy: '買', sell: '売' }
const statusLabels = {
  working: '執行中',
  filled: '約定済',
  canceled: '取消済',
  rejected: '失効',
}

onMounted(() => store.load())
</script>

<template>
  <section class="order-list">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む。
         defer が要る: 初回マウント時点ではレイアウトの DOM がまだ document に入っていない -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="orders-reload"
        :disabled="loading"
        @click="store.load()"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <!-- 以降の画面もこの4状態の出し分けを踏襲する -->
    <p v-if="loading" data-testid="orders-loading" class="order-list__status">読み込み中…</p>

    <div v-else-if="error" data-testid="orders-error" class="order-list__status is-error">
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="store.load()">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="orders-empty" class="order-list__status">
      注文はまだありません。
    </p>

    <DataTable v-else data-testid="orders-table" :columns="columns" :rows="items">
      <template #cell-side="{ value }">
        <span :class="['side', `side--${value}`]">{{ sideLabels[value] ?? value }}</span>
      </template>
      <template #cell-quantity="{ value }">{{ formatQuantity(value) }}</template>
      <template #cell-price="{ value }">{{ formatUsd(value) }}</template>
      <template #cell-status="{ value }">{{ statusLabels[value] ?? value }}</template>
      <template #cell-orderedAt="{ value }">{{ formatDateTime(value) }}</template>
    </DataTable>
  </section>
</template>

<style scoped>
.order-list__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.order-list__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}

.side--buy {
  color: var(--color-buy);
  font-weight: 600;
}

.side--sell {
  color: var(--color-sell);
  font-weight: 600;
}
</style>

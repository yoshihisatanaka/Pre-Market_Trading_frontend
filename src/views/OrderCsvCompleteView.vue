<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useOrderCsvStore } from '@/stores/orderCsv'
import { formatQuantity } from '@/utils/format'
import { SIDE_LABELS, orderPriceLabel } from '@/utils/orderCodeLabels'

/*
 * CSV一括注文の受付完了。プレビューで受け付けた結果（ストアの completion）を出す。
 *
 * 受付は済んでいて、この画面は読み込みを持たない。結果が無い（URL を直接開いた・再読み込みした）ときは
 * 空状態にして取込み画面へ戻す。受け付けた注文は Dream 登録待ちで、次回の定点 RPA が Dream へ登録する
 * （画面モック order_csv_complete の文面）。
 */

const store = useOrderCsvStore()
const { completion } = storeToRefs(store)
const router = useRouter()

/** 列の並びは画面モックどおり。受付状況と登録予定は全行同じ（受付直後はどれも Dream 登録待ち） */
const COLUMNS = [
  { key: 'rowNumber', label: '行', numeric: true },
  { key: 'receptionStatus', label: '受付状況' },
  { key: 'schedule', label: '登録予定' },
  { key: 'customerName', label: '顧客名' },
  { key: 'symbol', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'price', label: '価格' },
  { key: 'orderId', label: '注文ID' },
]

const stats = computed(() => {
  const total = completion.value?.totalOrders ?? 0
  return [
    { testid: 'order-csv-complete-total', label: '受付件数', value: total, tone: '' },
    { testid: 'order-csv-complete-pending', label: 'Dream登録待ち', value: total, tone: 'pending' },
  ]
})

function continueUpload() {
  store.clearCompletion()
  router.push({ name: 'order-csv-upload' })
}

function toDreamStatus() {
  router.push({ name: 'dream-status-list' })
}
</script>

<template>
  <section class="order-csv-complete">
    <BaseCard v-if="!completion" data-testid="order-csv-complete-empty">
      <div class="order-csv-complete__empty">
        <p>受付結果がありません。CSVを取込んで、プレビューから受付してください。</p>
        <BaseButton
          variant="secondary"
          data-testid="order-csv-complete-to-upload"
          @click="continueUpload"
        >
          CSV取込みへ
        </BaseButton>
      </div>
    </BaseCard>

    <template v-else>
      <div class="order-csv-complete__stats">
        <BaseCard v-for="stat in stats" :key="stat.testid" :data-testid="stat.testid">
          <div class="order-csv-complete__stat-label">{{ stat.label }}</div>
          <div :class="['order-csv-complete__stat-value', stat.tone && `is-${stat.tone}`]">
            {{ formatQuantity(stat.value) }}
          </div>
        </BaseCard>
      </div>

      <BaseAlert variant="success" data-testid="order-csv-complete-message">
        CSV注文を受け付けました。次回の定点RPA処理でDreamへ登録します。
      </BaseAlert>

      <BaseCard title="受付結果一覧" flush>
        <DataTable
          flat
          :columns="COLUMNS"
          :rows="completion.rows"
          row-key="rowNumber"
          data-testid="order-csv-complete-table"
        >
          <template #cell-receptionStatus>
            <span class="order-csv-complete__pending">Dream登録待ち</span>
          </template>
          <template #cell-schedule>次回定点RPA登録</template>
          <template #cell-customerName="{ value }">{{ value || '—' }}</template>

          <template #cell-symbol="{ row }">
            <span class="order-csv-complete__symbol">{{ row.order.symbol || '—' }}</span>
            <span v-if="row.stockName" class="order-csv-complete__sub">{{ row.stockName }}</span>
          </template>

          <template #cell-side="{ row }">
            <span :class="['order-csv-complete__side', `is-${row.order.side || 'unknown'}`]">
              {{ SIDE_LABELS[row.order.side] ?? '—' }}
            </span>
          </template>

          <template #cell-quantity="{ row }">{{ formatQuantity(row.order.quantity) }}</template>
          <template #cell-price="{ row }">{{ orderPriceLabel(row.order) }}</template>

          <!-- 注文ID はモックに合わせて # を前置する。採番が返らなかった行は「—」 -->
          <template #cell-orderId="{ value }">
            <span class="order-csv-complete__code">{{ value ? `#${value}` : '—' }}</span>
          </template>
        </DataTable>
      </BaseCard>

      <div class="order-csv-complete__actions">
        <BaseButton
          variant="secondary"
          data-testid="order-csv-complete-continue"
          @click="continueUpload"
        >
          続けてCSV取込み
        </BaseButton>
        <BaseButton data-testid="order-csv-complete-dream-status" @click="toDreamStatus">
          Dream登録状況へ
        </BaseButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.order-csv-complete {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.order-csv-complete__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-5);
  color: var(--color-text-muted);
  text-align: center;
}

/* 件数の 2 枠。狭い画面では 1 列へ畳む */
.order-csv-complete__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 600px) {
  .order-csv-complete__stats {
    grid-template-columns: 1fr;
  }
}

.order-csv-complete__stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
}

.order-csv-complete__stat-value {
  margin-top: var(--space-1);
  color: var(--color-text-heading);
  font-size: var(--font-size-2xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Dream 登録待ちはモックどおり青 */
.order-csv-complete__stat-value.is-pending,
.order-csv-complete__pending {
  color: var(--color-info-text);
}

.order-csv-complete__pending {
  font-weight: 600;
}

.order-csv-complete__symbol {
  font-weight: 500;
}

.order-csv-complete__sub {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-csv-complete__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.order-csv-complete__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}

.order-csv-complete__code {
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.order-csv-complete__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
}
</style>

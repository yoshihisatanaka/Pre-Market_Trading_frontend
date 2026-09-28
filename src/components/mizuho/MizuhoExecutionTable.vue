<script setup>
/**
 * みずほ注文締の約定一覧の表。列の並びは公開モック（/executions/mizuho-operations）のとおり。
 *
 * 行の形は src/api/mizuhoExecutions.js の MizuhoExecution。
 * 出す data-testid は無い。表そのものの testid は呼び出し側がフォールスルーで渡す。
 */
import DataTable from '@/components/ui/DataTable.vue'
import { formatFillStatus } from '@/utils/fillStatusTypes'
import { formatMonthDayTime, formatQuantity, formatUsd } from '@/utils/format'

defineProps({
  rows: {
    type: Array,
    required: true,
  },
})

const COLUMNS = [
  { key: 'id', label: '約定ID' },
  { key: 'orderId', label: '注文ID' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'symbol', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '元注文数量', numeric: true },
  { key: 'executedQuantity', label: '約定数量', numeric: true },
  { key: 'executedPrice', label: '約定単価(USD)', numeric: true },
  { key: 'executedAmountJpy', label: '約定金額(円)', numeric: true },
  { key: 'executedAt', label: '約定日時' },
  { key: 'fillStatus', label: '出来状況' },
  { key: 'routeName', label: '預託先' },
]

const sideLabels = { buy: '買', sell: '売' }

/** 値が取れなかったセルはモックと同じく空にせず '—' を出す */
function textOrDash(value) {
  return value || '—'
}

/** 出来状況。区分に当たらないコードのときはサーバの名称をそのまま出す */
function fillStatusLabel(row) {
  return formatFillStatus(row.fillStatus) || textOrDash(row.statusName)
}
</script>

<template>
  <DataTable flat :columns="COLUMNS" :rows="rows">
    <!-- 約定 ID・注文 ID はモックに合わせて # を前置する -->
    <template #cell-id="{ value }">
      <span class="mizuho-execution-table__code">#{{ value }}</span>
    </template>
    <template #cell-orderId="{ value }">
      <span class="mizuho-execution-table__code">#{{ value }}</span>
    </template>

    <template #cell-accountNumber="{ value }">{{ textOrDash(value) }}</template>
    <template #cell-customerName="{ value }">{{ textOrDash(value) }}</template>

    <template #cell-symbol="{ value }">
      <span class="mizuho-execution-table__symbol">{{ textOrDash(value) }}</span>
    </template>

    <template #cell-side="{ value }">
      <span :class="['mizuho-execution-table__side', `is-${value || 'unknown'}`]">
        {{ sideLabels[value] ?? '—' }}
      </span>
    </template>

    <template #cell-quantity="{ value }">{{ formatQuantity(value) }}</template>
    <template #cell-executedQuantity="{ value }">{{ formatQuantity(value) }}</template>
    <template #cell-executedPrice="{ value }">{{ formatUsd(value) }}</template>

    <!--
      約定金額（円）。ExecutionItem は 約定代金（USD）しか返さず、円の値の出所が無い。
      列（見出し）はモックどおり確保し、セルは常に '—' にしてある（顧客マスタの評価額と同じ扱い）。
      TODO(処理実装): 円貨の約定金額が仕様に入ったら api 層の toMizuhoExecution() に足して差し替える
    -->
    <template #cell-executedAmountJpy> — </template>

    <template #cell-executedAt="{ value }">
      <span class="mizuho-execution-table__muted">{{ formatMonthDayTime(value) }}</span>
    </template>

    <template #cell-fillStatus="{ row }">
      <span :class="['mizuho-execution-table__fill', `is-${row.fillStatus || 'unknown'}`]">
        {{ fillStatusLabel(row) }}
      </span>
    </template>

    <template #cell-routeName="{ value }">{{ textOrDash(value) }}</template>
  </DataTable>
</template>

<style scoped>
.mizuho-execution-table__code {
  font-family: var(--font-family-numeric);
  font-size: var(--font-size-xs);
}

.mizuho-execution-table__symbol {
  font-weight: 600;
}

/* 売買はモックどおり 買=赤 / 売=青 の太字。知らないコードのときは色を付けない */
.mizuho-execution-table__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.mizuho-execution-table__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}

.mizuho-execution-table__muted {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 出来状況はモックどおり 全部出来=緑 / 一部出来=琥珀。取消済（出来有）はモックに行が無いので控えめにする */
.mizuho-execution-table__fill {
  font-weight: 600;
}

.mizuho-execution-table__fill.is-filled {
  color: var(--color-success);
}

.mizuho-execution-table__fill.is-partial {
  color: var(--color-warning);
}

.mizuho-execution-table__fill.is-canceled_filled {
  color: var(--color-text-muted);
}
</style>

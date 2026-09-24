<script setup>
/**
 * 滞留注文の表。「注文エラー」と「注文中」の 2 本は最後から 2 列目だけが違い、
 * それ以外の 11 列は同じなので、列定義とセルの整形をここにまとめてある
 * （画面に同じ表を 2 回書かないため）。
 *
 * variant がその 1 列と出来状況の色を決める:
 *   errors  … 「エラー理由」列。出来状況を危険色で出す
 *   working … 「確認状況」列。出来状況を売り側の青で出す
 *
 * 出す data-testid は無い。表そのものの testid は呼び出し側がフォールスルーで渡す。
 *
 * @see StalledOrderListCard 4 状態と件数を持つカード（この表を差す器）
 */
import { computed } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import { formatDateTime, formatQuantity, formatUsd } from '@/utils/format'

const props = defineProps({
  rows: {
    type: Array,
    required: true,
  },
  variant: {
    type: String,
    required: true,
    validator: (value) => ['errors', 'working'].includes(value),
  },
})

/** 2 本の表で共通の 10 列。列の並びは画面モックのとおり */
const BASE_COLUMNS = [
  { key: 'id', label: '注文ID' },
  { key: 'branchCode', label: '部店' },
  { key: 'accountNumber', label: '口座番号', numeric: true },
  { key: 'customerName', label: '顧客名' },
  { key: 'symbol', label: '銘柄' },
  { key: 'side', label: '売買' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'limitPrice', label: '価格', numeric: true },
  { key: 'marketCategoryName', label: '市場区分' },
  { key: 'orderedAt', label: '受注日時' },
]

/** variant ごとに入れ替わる 1 列。どちらも長文なので折り返す（下の :deep を参照） */
const REASON_COLUMNS = {
  errors: { key: 'errorReason', label: 'エラー理由' },
  working: { key: 'confirmationNote', label: '確認状況' },
}

const columns = computed(() => [
  ...BASE_COLUMNS,
  REASON_COLUMNS[props.variant],
  { key: 'statusName', label: '出来状況' },
])

const sideLabels = { buy: '買', sell: '売' }

/** 値が取れなかったセルはモックと同じく空にせず '—' を出す */
function textOrDash(value) {
  return value || '—'
}

/**
 * 価格。成行は単価を持たないので区分名だけを出す。
 * モックは記号なしの `指値 228.5` だが、通貨が分かるよう formatUsd に揃えている。
 */
function priceLabel(row) {
  if (row.orderType === 'MO') return '成行'
  if (row.orderType === 'LO') return `指値 ${formatUsd(row.limitPrice)}`
  return '—'
}
</script>

<template>
  <DataTable flat :columns="columns" :rows="rows">
    <!-- 注文 ID はモックに合わせて # を前置する -->
    <template #cell-id="{ value }">#{{ value }}</template>

    <template #cell-branchCode="{ value }">{{ textOrDash(value) }}</template>
    <template #cell-accountNumber="{ value }">{{ textOrDash(value) }}</template>
    <template #cell-customerName="{ value }">{{ textOrDash(value) }}</template>

    <template #cell-symbol="{ value }">
      <span class="stalled-order-table__symbol">{{ textOrDash(value) }}</span>
    </template>

    <template #cell-side="{ value }">
      <span :class="['stalled-order-table__side', `is-${value || 'unknown'}`]">
        {{ sideLabels[value] ?? '—' }}
      </span>
    </template>

    <template #cell-quantity="{ value }">{{ formatQuantity(value) }}</template>
    <template #cell-limitPrice="{ row }">{{ priceLabel(row) }}</template>
    <template #cell-marketCategoryName="{ value }">{{ textOrDash(value) }}</template>
    <template #cell-orderedAt="{ value }">{{ formatDateTime(value) }}</template>

    <template #cell-errorReason="{ value }">
      <span class="stalled-order-table__reason">{{ textOrDash(value) }}</span>
    </template>
    <template #cell-confirmationNote="{ value }">
      <span class="stalled-order-table__reason">{{ textOrDash(value) }}</span>
    </template>

    <template #cell-statusName="{ value }">
      <span :class="['stalled-order-table__status', `is-${variant}`]">{{ textOrDash(value) }}</span>
    </template>
  </DataTable>
</template>

<style scoped>
.stalled-order-table__symbol {
  font-weight: 600;
}

/* 売買はモックどおり 買=赤 / 売=青 の太字。知らないコードのときは色を付けない */
.stalled-order-table__side.is-buy {
  color: var(--color-buy);
  font-weight: 600;
}

.stalled-order-table__side.is-sell {
  color: var(--color-sell);
  font-weight: 600;
}

/* 出来状況。注文エラーは危険色、注文中は落ち着いた青（モックの #1f4a73 の代わり） */
.stalled-order-table__status.is-errors {
  color: var(--color-danger-text);
  font-weight: 600;
}

.stalled-order-table__status.is-working {
  color: var(--color-sell);
  font-weight: 600;
}

/*
 * エラー理由・確認状況は 1 文以上の長文。DataTable のセルは既定で nowrap だが、
 * white-space は継承なので span 側で normal に戻せば折り返せる。
 * 幅を決め打ちするのは、長文 1 列が伸びて右端の「出来状況」を押し出さないようにするため。
 */
.stalled-order-table__reason {
  display: inline-block;
  min-width: 220px;
  max-width: 300px;
  white-space: normal;
}
</style>

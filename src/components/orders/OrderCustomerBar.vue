<script setup>
/**
 * 新規注文の顧客バー。口座番号の照会で見つかった顧客を、フォームの上に 1 段で見せる
 * （モックの customer-bar）。顧客詳細から入ったときは親の顧客カードが同じ顧客を出すので、
 * 画面（views/OrderEntryView.vue）がこのバーを出さない。
 *
 * 注意の表示はモックと同じ 3 つ: コンプラランク A・B・Y・Z / 85 歳以上 / 全取引停止
 * （判定の規則は utils/customerCautions.js。顧客詳細の顧客カードと同じ）。
 * これは入力中に目に入れるための表示で、発注を止めるかはサーバ（POST /orders/validate）が決める。
 * 評価額・評価損益は /balances を組み込むまで出さない。
 */
import { computed } from 'vue'
import {
  isCautionRank as isCautionRankCode,
  isElderly as isElderlyAge,
  parseAge,
} from '@/utils/customerCautions'
import { formatJpyUnit, formatUsdUnit } from '@/utils/format'

const props = defineProps({
  /** src/api/customers.js の Customer */
  customer: {
    type: Object,
    required: true,
  },
})

// 年齢は実 API でも文字列で、法人は空。数字として読めるときだけ判定する
const age = computed(() => parseAge(props.customer.age))

const isElderly = computed(() => isElderlyAge(props.customer.age))
const isCautionRank = computed(() => isCautionRankCode(props.customer.complianceRank))
</script>

<template>
  <div class="order-customer-bar" data-testid="order-entry-customer-bar">
    <p class="order-customer-bar__identity">
      <strong class="order-customer-bar__name" data-testid="order-entry-customer-name">
        {{ customer.customerName }}
      </strong>
      <span class="order-customer-bar__kana">{{ customer.customerNameKana }}</span>
      <span
        v-if="isCautionRank"
        class="order-customer-bar__caution"
        data-testid="order-entry-customer-compliance"
      >
        コンプラ {{ customer.complianceRank }} 要注意
      </span>
      <span
        v-if="isElderly"
        class="order-customer-bar__elderly"
        data-testid="order-entry-customer-elderly"
      >
        {{ age }}歳 高齢者
      </span>
      <span
        v-if="customer.tradingSuspended"
        class="order-customer-bar__caution"
        data-testid="order-entry-customer-suspended"
      >
        全取引停止
      </span>
    </p>

    <dl class="order-customer-bar__assets">
      <div>
        <dt>円貨預り金</dt>
        <dd data-testid="order-entry-customer-cash-jpy">{{ formatJpyUnit(customer.cashJpy) }}</dd>
      </div>
      <div>
        <dt>外貨預り金</dt>
        <dd data-testid="order-entry-customer-cash-usd">{{ formatUsdUnit(customer.cashUsd) }}</dd>
      </div>
      <div>
        <dt>成長投資枠</dt>
        <dd data-testid="order-entry-customer-growth-quota">
          {{ formatJpyUnit(customer.growthQuota) }}
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.order-customer-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-5);
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-info-bg);
  border-left: 4px solid var(--color-info-text);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  font-size: var(--font-size-sm);
  color: var(--color-info-text);
}

.order-customer-bar__identity {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.order-customer-bar__name {
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
}

.order-customer-bar__caution {
  color: var(--color-danger-text);
  font-weight: 600;
}

.order-customer-bar__elderly {
  color: var(--color-warning);
  font-weight: 600;
}

.order-customer-bar__assets {
  display: flex;
  gap: var(--space-4);
  margin: 0;
}

.order-customer-bar__assets div {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.order-customer-bar__assets dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-customer-bar__assets dd {
  margin: 0;
  color: var(--color-text);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
</style>

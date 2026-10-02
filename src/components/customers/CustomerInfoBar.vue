<script setup>
/**
 * 顧客詳細の顧客カード（画面モック customer_summary.html / customer_order_inquiry.html の
 * customer-info-bar）。上段に部店・口座番号・顧客名と属性 4 項目、下段に資産状況 5 項目を出す。
 *
 * 注意の表示はモックと同じ 3 つ: 85 歳以上（高齢者）/ 全取引停止 / コンプラランク A・B・Y・Z（要注意）。
 * 判定の規則は utils/customerCautions.js（新規注文の顧客バーと同じ）。
 *
 * 資産状況のうち「米国株評価額」「評価損益」は預りの合計で、顧客とは別に読む
 * （stores/customerDetail.js の valuation）。読めていないあいだは「—」を出す。
 *
 * 出す data-testid:
 *   customer-info-bar / customer-info-branch / customer-info-account / customer-info-name /
 *   customer-info-kana / customer-info-age / customer-info-elderly / customer-info-restriction /
 *   customer-info-policy / customer-info-compliance / customer-info-compliance-caution /
 *   customer-info-cash-jpy / customer-info-cash-usd / customer-info-growth-quota /
 *   customer-info-valuation / customer-info-profit-loss
 */
import { computed } from 'vue'
import { isCautionRank, isElderly, parseAge } from '@/utils/customerCautions'
import { formatJpyUnit, formatUsdUnit } from '@/utils/format'
import { formatSignedJpyUnit, profitLossTone } from '@/utils/profitLoss'

const props = defineProps({
  /** src/api/customers.js の Customer */
  customer: {
    type: Object,
    required: true,
  },
  /**
   * 預りの合計（stores/customerDetail.js の valuation）。`{ valueJpy, profitLossJpy }`。
   * 読み込み中・失敗のときは null（「—」を出す）
   */
  valuation: {
    type: Object,
    default: null,
  },
})

const age = computed(() => parseAge(props.customer.age))
const elderly = computed(() => isElderly(props.customer.age))
const caution = computed(() => isCautionRank(props.customer.complianceRank))

/** 年齢。法人は年齢を持たない（実 API でも空）ので「—」 */
const ageLabel = computed(() => (age.value === null ? '—' : `${age.value}歳`))

const profitLoss = computed(() => props.valuation?.profitLossJpy ?? null)
/** 評価損益の色（益=赤 / 損=青）。0 と値なしは色を付けない */
const profitLossClass = computed(() => {
  const tone = profitLossTone(profitLoss.value)
  return tone ? `is-${tone}` : null
})
</script>

<template>
  <section class="customer-info-bar" data-testid="customer-info-bar">
    <div class="customer-info-bar__top">
      <div class="customer-info-bar__identity">
        <p class="customer-info-bar__reference">
          <span class="customer-info-bar__reference-item">
            <span class="customer-info-bar__label">部店</span>
            <span data-testid="customer-info-branch">{{ customer.branchCode || '—' }}</span>
          </span>
          <span class="customer-info-bar__divider" aria-hidden="true" />
          <span class="customer-info-bar__reference-item">
            <span class="customer-info-bar__label">口座番号</span>
            <span data-testid="customer-info-account">{{ customer.accountNumber || '—' }}</span>
          </span>
        </p>
        <p class="customer-info-bar__name">
          <span data-testid="customer-info-name">{{ customer.customerName || '—' }}</span>
          <span
            v-if="customer.customerNameKana"
            class="customer-info-bar__kana"
            data-testid="customer-info-kana"
          >
            {{ customer.customerNameKana }}
          </span>
        </p>
      </div>

      <dl class="customer-info-bar__metrics">
        <div class="customer-info-bar__item">
          <dt>年齢</dt>
          <dd :class="{ 'is-elderly': elderly }" data-testid="customer-info-age">
            {{ ageLabel }}
            <span
              v-if="elderly"
              class="customer-info-bar__note"
              data-testid="customer-info-elderly"
            >
              高齢者
            </span>
          </dd>
        </div>
        <div class="customer-info-bar__item">
          <dt>取引規制</dt>
          <dd
            :class="{ 'is-caution': customer.tradingSuspended }"
            data-testid="customer-info-restriction"
          >
            {{ customer.tradingSuspended ? '全取引停止' : '制限なし' }}
          </dd>
        </div>
        <div class="customer-info-bar__item">
          <dt>投資方針</dt>
          <dd data-testid="customer-info-policy">{{ customer.investmentPolicyName || '—' }}</dd>
        </div>
        <div class="customer-info-bar__item">
          <dt>コンプラランク</dt>
          <dd :class="{ 'is-caution': caution }" data-testid="customer-info-compliance">
            {{ customer.complianceRank || '—' }}
            <span
              v-if="caution"
              class="customer-info-bar__note"
              data-testid="customer-info-compliance-caution"
            >
              要注意
            </span>
          </dd>
        </div>
      </dl>
    </div>

    <!-- 資産状況。金額は右寄せで、単位を後置する（utils/format.js） -->
    <dl class="customer-info-bar__assets">
      <div class="customer-info-bar__item">
        <dt>円貨預り金</dt>
        <dd data-testid="customer-info-cash-jpy">{{ formatJpyUnit(customer.cashJpy) }}</dd>
      </div>
      <div class="customer-info-bar__item">
        <dt>USD預り金</dt>
        <dd data-testid="customer-info-cash-usd">{{ formatUsdUnit(customer.cashUsd) }}</dd>
      </div>
      <div class="customer-info-bar__item">
        <dt>成長投資枠</dt>
        <dd data-testid="customer-info-growth-quota">{{ formatJpyUnit(customer.growthQuota) }}</dd>
      </div>
      <div class="customer-info-bar__item">
        <dt>米国株評価額</dt>
        <dd data-testid="customer-info-valuation">
          {{ formatJpyUnit(valuation?.valueJpy ?? null) }}
        </dd>
      </div>
      <div class="customer-info-bar__item">
        <dt>評価損益</dt>
        <dd :class="profitLossClass" data-testid="customer-info-profit-loss">
          {{ formatSignedJpyUnit(profitLoss) }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.customer-info-bar {
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.customer-info-bar__top {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--space-3) var(--space-5);
  padding: var(--space-3) var(--space-5);
}

.customer-info-bar__identity {
  display: flex;
  flex: 0 0 340px;
  flex-direction: column;
  gap: var(--space-1);
  padding-right: var(--space-5);
  border-right: 1px solid var(--color-border);
}

.customer-info-bar__reference {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: 500;
}

.customer-info-bar__reference-item {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  font-variant-numeric: tabular-nums;
}

.customer-info-bar__divider {
  width: 1px;
  height: 13px;
  background-color: var(--color-border);
}

.customer-info-bar__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.customer-info-bar__name {
  margin: 0;
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 500;
  white-space: nowrap;
}

.customer-info-bar__kana {
  margin-left: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  font-weight: 400;
}

.customer-info-bar__metrics,
.customer-info-bar__assets {
  display: grid;
  margin: 0;
}

.customer-info-bar__metrics {
  flex: 1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
}

/* 資産状況の段。面を一段沈めて上段と分ける（モックの .asset-status-row） */
.customer-info-bar__assets {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  padding: var(--space-2) var(--space-5) var(--space-3);
  background-color: var(--color-surface-muted);
  border-top: 1px solid var(--color-border);
}

.customer-info-bar__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 0 var(--space-4);
  border-left: 1px solid var(--color-border);
}

.customer-info-bar__item:first-child {
  padding-left: 0;
  border-left: none;
}

.customer-info-bar__item dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.customer-info-bar__item dd {
  margin: 0;
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 500;
  white-space: nowrap;
}

.customer-info-bar__assets dd {
  font-size: var(--font-size-xl);
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.customer-info-bar__note {
  font-size: var(--font-size-xs);
}

.customer-info-bar__item dd.is-elderly {
  color: var(--color-warning);
}

.customer-info-bar__item dd.is-caution {
  color: var(--color-danger-text);
}

.customer-info-bar__assets dd.is-profit {
  color: var(--color-profit);
}

.customer-info-bar__assets dd.is-loss {
  color: var(--color-loss);
}

/* 狭い画面では識別と属性を縦に積み、資産状況は 3 列に折り返す（モックの @media 980px） */
@media (max-width: 980px) {
  .customer-info-bar__identity {
    flex-basis: 100%;
    padding-right: 0;
    padding-bottom: var(--space-3);
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }

  .customer-info-bar__assets {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: var(--space-2);
  }

  .customer-info-bar__assets .customer-info-bar__item:nth-child(3n + 1) {
    padding-left: 0;
    border-left: none;
  }
}
</style>

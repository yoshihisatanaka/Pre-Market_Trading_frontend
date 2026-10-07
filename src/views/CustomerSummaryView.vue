<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import DataTable from '@/components/ui/DataTable.vue'
import MasterListCard from '@/components/masters/MasterListCard.vue'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useCustomerDetailStore } from '@/stores/customerDetail'
import { holdingCalculationQuery } from '@/utils/calculationQuery'
import { formatJpyUnit, formatQuantity, formatUsdUnit } from '@/utils/format'
import { buildOrderEntryQuery, holdingOrderQuery } from '@/utils/orderEntryQuery'
import { SIDE } from '@/utils/orderEntryOptions'
import { formatSignedJpyUnit, formatSignedPercent, profitLossTone } from '@/utils/profitLoss'

/*
 * 顧客詳細の外株預りタブ（画面モック customer_summary.html の「外国株式 N銘柄」のカード）。
 * 顧客と預りは枠（views/CustomerDetailView.vue）が読んだものを stores/customerDetail.js から受け取る。
 * この画面が描かれるのは顧客を読み終えてからなので、customer は常に居る。
 *
 * 行の「買い」「売り」と「新規注文」は、注文入力タブ（/customers/:customerId/order-entry）へ
 * 顧客・銘柄・売買・預り区分（「売り」は売却可能株数も）を URL クエリで引き継いで移る（utils/orderEntryQuery.js）。
 * 発注権限（GET /auth/me の order）の
 * 無い利用者には出さない（注文照会の「新規注文」「訂正」「取消」と同じ扱い）。
 *
 * 「仮計算」は顧客詳細の仮計算タブ（/customers/:customerId/calculations）へ移る。見出しのものは買いで始め、
 * 行のものは銘柄・売り・預り区分を URL クエリで引き継ぐ（utils/calculationQuery.js）。発注ではないので、
 * 発注権限の無い利用者にも出す（IFA は「参照・仮計算のみ」）。
 * IB 取扱のバッジ（ib_available）は `GET /holdings` に該当する項目が無いので出さない。
 */

const route = useRoute()

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useCustomerDetailStore()
const {
  customer,
  holdings,
  holdingsTotal,
  holdingsError,
  holdingsPending,
  holdingsEmpty,
  hasCorporateAction,
} = storeToRefs(store)

/*
 * 発注権限での出し分け（views/OrderInquiryListView.vue と同じ）。このルートは権限を要求しないので、
 * 読み終えるまではどちらとも決まらない。そのあいだは発注の導線を出さない。
 */
const operator = useCurrentOperatorStore()
operator.ensureLoaded()
const canOrder = computed(() => operator.can('order'))
const operatorPending = computed(() => !operator.operator && !operator.error)

/** 評価の時点（モックの「YYYY/MM/DD時点」）。画面を開いた日で、評価額の基準（前日終値）の日ではない */
const asOf = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

/** 参考為替は円 / ドルの小数第 2 位まで（モックの "%.2f"） */
const fxRateFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/* 列は画面モックの並びどおり（見出しの 2 段は「／」で 1 行にまとめる） */
const columns = [
  { key: 'ticker', label: 'ティッカー' },
  { key: 'symbolCode', label: '銘柄コード' },
  { key: 'symbolName', label: '銘柄名' },
  { key: 'quantity', label: '数量', numeric: true },
  { key: 'specificDeposit', label: '預り区分' },
  { key: 'referencePrice', label: '参考単価（USD）', numeric: true },
  { key: 'referenceFxRate', label: '参考為替（USD/JPY）', numeric: true },
  { key: 'valuation', label: '取得金額／評価額（円）', numeric: true },
  { key: 'profitLoss', label: '評価損益／評価損益率', numeric: true },
  { key: 'corporateAction', label: 'CA' },
  { key: 'actions', label: '操作' },
]

/*
 * customer は枠が読み終えてから描かれるので常に居るが、別の顧客へ移る瞬間（枠が customer を空にして
 * この画面を外すまで）に評価されても落ちないよう、空の顧客として扱う。
 */
const customerKey = computed(() => ({
  branchCode: customer.value?.branchCode ?? '',
  accountNumber: customer.value?.accountNumber ?? '',
}))

/** 顧客詳細の注文入力タブ。顧客カードとタブを残したまま新規注文を出す */
const orderEntryRoute = (query) => ({
  name: 'customer-order-entry',
  params: { customerId: route.params.customerId },
  query,
})

const newOrderRoute = computed(() => orderEntryRoute(buildOrderEntryQuery(customerKey.value)))

function tradeRoute(holding, side) {
  return orderEntryRoute(holdingOrderQuery(customerKey.value, holding, side))
}

/** 顧客は枠と同じ（パスの customerId）。行のものだけ銘柄・売り・預り区分を載せる */
const calculationRoute = computed(() => ({
  name: 'customer-calculations',
  params: { customerId: String(route.params.customerId ?? '') },
}))

function holdingCalculationRoute(holding) {
  return { ...calculationRoute.value, query: holdingCalculationQuery(holding) }
}

function profitLossClass(holding) {
  const tone = profitLossTone(holding.profitLossJpy)
  return tone ? `is-${tone}` : null
}
</script>

<template>
  <MasterListCard
    testid-prefix="customer-holdings"
    title="外国株式"
    unit="銘柄"
    empty-message="保有外株なし"
    :total="holdingsTotal"
    :paginated="false"
    :loading="holdingsPending"
    :is-empty="holdingsEmpty"
    :error="holdingsError"
    @reload="store.reloadHoldings()"
  >
    <template #actions>
      <span class="customer-summary__as-of" data-testid="customer-holdings-as-of"
        >{{ asOf }}時点</span
      >
      <RouterLink
        v-if="!operatorPending && canOrder"
        :to="newOrderRoute"
        class="customer-summary__new-order"
        data-testid="customer-holdings-new-order"
      >
        ＋ 新規注文
      </RouterLink>
      <RouterLink
        :to="calculationRoute"
        class="customer-summary__calc-entry"
        data-testid="customer-holdings-calculation-entry"
      >
        仮計算
      </RouterLink>
    </template>

    <div class="customer-summary">
      <BaseAlert
        v-if="hasCorporateAction"
        variant="warning"
        class="customer-summary__alert"
        data-testid="customer-holdings-ca-warning"
      >
        <strong>CA（コーポレートアクション）発生中の銘柄があります。</strong><br />
        基幹システムの残高数量は前営業日基準のため、株式分割・併合等の CA 発生時は当日時価との間に
        タイミングズレが生じます。評価額が実際と大きく異なる場合がありますのでご注意ください。
      </BaseAlert>

      <DataTable flat data-testid="customer-holdings-table" :columns="columns" :rows="holdings">
        <template #cell-ticker="{ row }">
          <span class="customer-summary__ticker">{{ row.ticker || '—' }}</span>
        </template>

        <template #cell-symbolCode="{ row }">{{ row.symbolCode || '—' }}</template>
        <template #cell-symbolName="{ row }">{{ row.symbolName || '—' }}</template>

        <template #cell-quantity="{ row }">{{ formatQuantity(row.quantity) }}株</template>

        <template #cell-specificDeposit="{ row }">{{ row.specificDepositName || '—' }}</template>

        <template #cell-referencePrice="{ row }">{{ formatUsdUnit(row.referencePrice) }}</template>

        <template #cell-referenceFxRate="{ row }">
          {{ row.referenceFxRate === null ? '—' : fxRateFormat.format(row.referenceFxRate) }}
        </template>

        <!-- 取得金額（淡色）の下に評価額。CA 発生中は警告色にして注意の印を添える（モックの .ca-row） -->
        <template #cell-valuation="{ row }">
          <div :class="['customer-summary__stack', { 'is-corporate-action': row.corporateAction }]">
            <span class="customer-summary__cost">{{ formatJpyUnit(row.costJpy) }}</span>
            <span class="customer-summary__value">
              {{ formatJpyUnit(row.valueJpy) }}
              <span
                v-if="row.corporateAction"
                class="customer-summary__ca-mark"
                title="CA発生中：評価額に注意"
                aria-label="CA発生中：評価額に注意"
                data-testid="customer-holdings-ca-mark"
              >
                ⚠
              </span>
            </span>
          </div>
        </template>

        <template #cell-profitLoss="{ row }">
          <div
            :class="[
              'customer-summary__stack',
              'customer-summary__profit-loss',
              profitLossClass(row),
            ]"
          >
            <span class="customer-summary__amount">{{
              formatSignedJpyUnit(row.profitLossJpy)
            }}</span>
            <span>{{ formatSignedPercent(row.profitLossRate) }}</span>
          </div>
        </template>

        <template #cell-corporateAction="{ row }">
          <span v-if="row.corporateAction" class="customer-summary__ca">{{
            row.corporateAction
          }}</span>
          <span v-else class="customer-summary__muted">—</span>
        </template>

        <!--
          発注権限を読み終えるまでは何も出さない（「閲覧のみ」がちらつかない）。
          「仮計算」は権限によらず出すが、列が後から伸びないよう同じときに出す
        -->
        <template #cell-actions="{ row }">
          <div v-if="!operatorPending" class="customer-summary__actions">
            <span
              v-if="!canOrder"
              class="customer-summary__muted"
              data-testid="customer-holdings-view-only"
            >
              閲覧のみ
            </span>
            <template v-else>
              <RouterLink
                :to="tradeRoute(row, SIDE.BUY)"
                class="customer-summary__trade is-buy"
                data-testid="customer-holdings-buy"
              >
                買い
              </RouterLink>
              <!-- 売却不可（売却不可区分=1）の明細は押せない売りボタンを出す（モックと同じ） -->
              <button
                v-if="row.sellProhibited"
                type="button"
                class="customer-summary__trade is-sell"
                disabled
                title="現在売却できません。"
                data-testid="customer-holdings-sell"
              >
                売り
              </button>
              <RouterLink
                v-else
                :to="tradeRoute(row, SIDE.SELL)"
                class="customer-summary__trade is-sell"
                data-testid="customer-holdings-sell"
              >
                売り
              </RouterLink>
            </template>
            <RouterLink
              :to="holdingCalculationRoute(row)"
              class="customer-summary__trade is-calc"
              data-testid="customer-holdings-calculation"
            >
              仮計算
            </RouterLink>
          </div>
        </template>
      </DataTable>
    </div>
  </MasterListCard>
</template>

<style scoped>
.customer-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* CA の帯は表の上に、カードの内側の余白を取って置く（カードは flush で余白を持たない） */
.customer-summary__alert {
  margin: var(--space-3) var(--space-4) 0;
}

.customer-summary__as-of {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* カード見出しの「＋ 新規注文」。主操作なので濃紺の面（モックの .order-btn-new） */
.customer-summary__new-order {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  background-color: var(--color-primary);
  color: var(--color-primary-contrast);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.customer-summary__new-order:hover {
  background-color: var(--color-primary-hover);
}

/* カード見出しの「仮計算」。新規注文と同じ大きさで、色は仮計算の灰青（モックの .calc-entry-btn） */
.customer-summary__calc-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 82px;
  height: 30px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  background-color: var(--color-calculation);
  color: var(--color-primary-contrast);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.customer-summary__calc-entry:hover {
  background-color: var(--color-calculation-hover);
}

.customer-summary__ticker {
  font-weight: 600;
}

/* 2 段表示のセル（取得金額／評価額、評価損益／率）。右に揃える */
.customer-summary__stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  line-height: 1.25;
}

.customer-summary__cost {
  color: var(--color-text-muted);
}

.customer-summary__value,
.customer-summary__amount {
  font-weight: 600;
}

.customer-summary__profit-loss.is-profit {
  color: var(--color-profit);
}

.customer-summary__profit-loss.is-loss {
  color: var(--color-loss);
}

.customer-summary__stack.is-corporate-action,
.customer-summary__stack.is-corporate-action .customer-summary__cost {
  color: var(--color-warning);
}

.customer-summary__ca-mark {
  margin-left: var(--space-1);
  cursor: help;
}

.customer-summary__ca {
  color: var(--color-warning);
}

.customer-summary__muted {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.customer-summary__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
}

/* 行の「買い」「売り」。売買の色の小さなボタン（モックの .order-btn-buy / .order-btn-sell） */
.customer-summary__trade {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-primary-contrast);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.customer-summary__trade.is-buy {
  background-color: var(--color-buy);
}

.customer-summary__trade.is-buy:hover {
  background-color: var(--color-buy-hover);
}

.customer-summary__trade.is-sell {
  background-color: var(--color-sell);
}

.customer-summary__trade.is-sell:hover {
  background-color: var(--color-sell-hover);
}

/* 行の「仮計算」（モックの .calc-row-btn） */
.customer-summary__trade.is-calc {
  background-color: var(--color-calculation);
}

.customer-summary__trade.is-calc:hover {
  background-color: var(--color-calculation-hover);
}

.customer-summary__trade:disabled {
  background-color: var(--color-input-border);
  cursor: not-allowed;
}
</style>

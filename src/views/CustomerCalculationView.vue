<script setup>
import { computed, reactive } from 'vue'
import { useRoute } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import { SPECIFIC_DEPOSIT } from '@/utils/apiEnums'
import {
  CALCULATION_DEPOSIT_OPTIONS,
  FEE_PATTERN_OPTIONS,
  LOCAL_FEE_CATEGORY_OPTIONS,
} from '@/utils/calculationOptions'
import { parseCalculationQuery } from '@/utils/calculationQuery'
import { SIDE, SIDE_OPTIONS } from '@/utils/orderEntryOptions'

/*
 * 顧客詳細の仮計算タブ（画面モック provisional_calculation.html）。
 * 顧客カードとタブは枠（views/CustomerDetailView.vue）が描くので、ここは入力フォームと結果のカードだけを持つ。
 *
 * **いまは見た目だけ。** 入力欄は値を持つだけで、「仮計算を実行」は何もしない（`POST /calculations` は未接続）。
 * 結果のカードは枠だけを出し、金額は「—」で埋める。読み込みが無いので 4 状態もまだ無い
 * （つなぐときに、実行中 / エラー / 未実行 / 結果あり として足す）。
 *
 * 外株預り・預り検索の行の「仮計算」からは、銘柄・売買・預り区分が URL クエリで引き継がれる
 * （utils/calculationQuery.js）。タブと外株預りの見出しの「仮計算」から入ったときは買いで始まる（モックと同じ）。
 *
 * モックとの差・つなぐときに決めること:
 *   - 国内約定日・現地手数料区分は CalculationRequest に対応する項目が無い（docs/api/requests.md #47 で依頼中）
 *   - 結果の行はモックの並び。応答（CalculationResponse）は 外貨 / 円貨 の 2 ブロックで、行との対応はまだ決めていない
 *   - 預りから売りで入ったときに預り区分をその明細に固定する（モックのスクリプト）のは、預りの明細を引けるようになってから
 */

const route = useRoute()

/** 結果のカードの金額。仮計算をつなぐまでは全部これ */
const PLACEHOLDER = '—'

/** 国内約定日の既定は今日（モックと同じ YYYYMMDD） */
function todayYmd() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

// 引き継ぎは開いたときに 1 回だけ読む（入力を始めたあとで URL に合わせて書き換えない）
const initial = parseCalculationQuery(route.query)

const form = reactive({
  symbol: initial.symbol,
  side: initial.side || SIDE.BUY,
  specificDeposit: initial.specificDeposit || SPECIFIC_DEPOSIT.SPECIFIC,
  quantity: '',
  fxRate: '',
  unitPrice: '',
  domesticTradeDate: todayYmd(),
  localFee1: '',
  localFee2: '',
  localFeeCategory: LOCAL_FEE_CATEGORY_OPTIONS[0].value,
  localTax1: '',
  localTax2: '',
  localTax3: '',
  otherCost1: '',
  otherCost2: '',
  taxExempt: false,
  feePattern: '',
  feeMultiplier: '',
  basisPoints: '',
  feeFrom: '',
  feeTo: '',
})

const isSell = computed(() => form.side === SIDE.SELL)

/** 成長投資枠の買付だけ、NISA 用の為替（上乗せ後）と上乗せ額の行を足す（モックと同じ） */
const isNisaBuy = computed(
  () => form.side === SIDE.BUY && form.specificDeposit === SPECIFIC_DEPOSIT.GROWTH_QUOTA,
)

const estimateLabel = computed(() => (isSell.value ? '売却概算' : '買付概算'))
const totalLabel = computed(() => (isSell.value ? '概算受取金額' : '概算必要金額'))

/** 結果の明細行（モックの並び）。金額はまだ出さないので見出しだけ */
const resultRows = computed(() => [
  { key: 'grossUsd', label: '外貨約定代金' },
  { key: 'localCostUsd', label: '現地費用合計' },
  { key: 'exchangeTax', label: '取引所税' },
  { key: 'grossJpy', label: '円換算約定金額' },
  { key: 'localCostJpy', label: '円換算現地費用' },
  { key: 'spreadJpy', label: '円換算スプレッド' },
  ...(isNisaBuy.value
    ? [
        { key: 'nisaFxRate', label: 'NISA仮計算適用為替' },
        { key: 'nisaFxBuffer', label: 'NISA仮計算用為替上乗せ' },
      ]
    : []),
  { key: 'domesticFee', label: '国内手数料' },
  { key: 'consumptionTax', label: '消費税' },
])

const backRoute = computed(() => ({
  name: 'customer-summary',
  params: { customerId: String(route.params.customerId ?? '') },
}))
</script>

<template>
  <div class="customer-calc">
    <!--
      novalidate: required は必須マークと aria のためのもの。ブラウザ標準の吹き出し（英語）は出さない。
      送信はまだ何もしない（上のコメント）
    -->
    <form class="customer-calc__form" data-testid="customer-calc-form" novalidate @submit.prevent>
      <section class="customer-calc__section">
        <div class="customer-calc__fields is-primary">
          <FormField
            v-slot="{ field }"
            label="銘柄コード／ティッカー"
            required
            hint="銘柄コードまたはティッカーで検索"
            class="customer-calc__symbol"
          >
            <BaseInput
              v-bind="field"
              v-model="form.symbol"
              maxlength="14"
              placeholder="例：AAPL / A0001"
              autocomplete="off"
              data-testid="customer-calc-symbol"
            />
          </FormField>

          <!-- ボタンの並びなので label 要素と結び付けられない。名前は aria-label で持たせる -->
          <FormField label="売買" required>
            <BaseSegmentedControl
              v-model="form.side"
              :options="SIDE_OPTIONS"
              aria-label="売買"
              data-testid="customer-calc-side"
            />
          </FormField>

          <FormField v-slot="{ field }" label="預り区分">
            <BaseSelect
              v-bind="field"
              v-model="form.specificDeposit"
              :options="CALCULATION_DEPOSIT_OPTIONS"
              data-testid="customer-calc-deposit"
            />
          </FormField>

          <FormField v-slot="{ field }" label="数量" required hint="1株単位">
            <BaseInput
              v-bind="field"
              v-model="form.quantity"
              class="customer-calc__number"
              inputmode="numeric"
              maxlength="9"
              placeholder="1"
              autocomplete="off"
              data-testid="customer-calc-quantity"
            />
          </FormField>

          <FormField v-slot="{ field }" label="為替（USD/JPY）" hint="未入力時は補完">
            <BaseInput
              v-bind="field"
              v-model="form.fxRate"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-fx-rate"
            />
          </FormField>

          <FormField v-slot="{ field }" label="単価（USD）" required>
            <BaseInput
              v-bind="field"
              v-model="form.unitPrice"
              class="customer-calc__number"
              inputmode="decimal"
              placeholder="0.00000000"
              autocomplete="off"
              data-testid="customer-calc-unit-price"
            />
          </FormField>

          <FormField v-slot="{ field }" label="国内約定日" hint="YYYYMMDD">
            <BaseInput
              v-bind="field"
              v-model="form.domesticTradeDate"
              inputmode="numeric"
              maxlength="8"
              autocomplete="off"
              data-testid="customer-calc-trade-date"
            />
          </FormField>
        </div>
      </section>

      <section class="customer-calc__section">
        <h2 class="customer-calc__section-title">
          現地費用<span class="customer-calc__section-note">外貨建て</span>
        </h2>
        <div class="customer-calc__fields is-local-fee">
          <FormField
            v-slot="{ field }"
            label="現地手数料（外貨）①"
            hint="未入力時は仮計算マスタで自動計算"
            class="customer-calc__wide"
          >
            <BaseInput
              v-bind="field"
              v-model="form.localFee1"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-local-fee-1"
            />
          </FormField>

          <FormField v-slot="{ field }" label="現地手数料（外貨）②" class="customer-calc__wide">
            <BaseInput
              v-bind="field"
              v-model="form.localFee2"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-local-fee-2"
            />
          </FormField>

          <FormField
            v-slot="{ field }"
            label="現地手数料区分"
            hint="ネゴレート・NETは自動計算なし"
            class="customer-calc__wide"
          >
            <BaseSelect
              v-bind="field"
              v-model="form.localFeeCategory"
              :options="LOCAL_FEE_CATEGORY_OPTIONS"
              data-testid="customer-calc-local-fee-category"
            />
          </FormField>

          <FormField
            v-slot="{ field }"
            label="現地取引税（外貨）①"
            hint="3項目とも未入力時は取引所税を自動計算"
          >
            <BaseInput
              v-bind="field"
              v-model="form.localTax1"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-local-tax-1"
            />
          </FormField>

          <FormField v-slot="{ field }" label="現地取引税（外貨）②">
            <BaseInput
              v-bind="field"
              v-model="form.localTax2"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-local-tax-2"
            />
          </FormField>

          <FormField v-slot="{ field }" label="現地取引税（外貨）③">
            <BaseInput
              v-bind="field"
              v-model="form.localTax3"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-local-tax-3"
            />
          </FormField>

          <FormField v-slot="{ field }" label="その他諸経費（外貨）①">
            <BaseInput
              v-bind="field"
              v-model="form.otherCost1"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-other-cost-1"
            />
          </FormField>

          <FormField v-slot="{ field }" label="その他諸経費（外貨）②">
            <BaseInput
              v-bind="field"
              v-model="form.otherCost2"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-other-cost-2"
            />
          </FormField>

          <FormField v-slot="{ field }" label="消費税不要区分">
            <!--
              BaseCheckbox は invalid を props に持たないので、field は id だけを渡す。
              属性は中の input に付くので、高さをそろえる器は外に置く
            -->
            <div class="customer-calc__check">
              <BaseCheckbox
                :id="field.id"
                v-model="form.taxExempt"
                label="消費税不要"
                data-testid="customer-calc-tax-exempt"
              />
            </div>
          </FormField>
        </div>
      </section>

      <section class="customer-calc__section">
        <h2 class="customer-calc__section-title">
          手数料条件<span class="customer-calc__section-note">未入力時は顧客属性の設定を補完</span>
        </h2>
        <div class="customer-calc__fields is-fee-condition">
          <FormField v-slot="{ field }" label="手数料パターン">
            <BaseSelect
              v-bind="field"
              v-model="form.feePattern"
              :options="FEE_PATTERN_OPTIONS"
              placeholder="顧客属性を適用"
              data-testid="customer-calc-fee-pattern"
            />
          </FormField>

          <FormField v-slot="{ field }" label="手数料掛目（%）">
            <BaseInput
              v-bind="field"
              v-model="form.feeMultiplier"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-fee-multiplier"
            />
          </FormField>

          <FormField v-slot="{ field }" label="ベイシスポイント" hint="0〜999.99">
            <BaseInput
              v-bind="field"
              v-model="form.basisPoints"
              class="customer-calc__number"
              inputmode="decimal"
              autocomplete="off"
              data-testid="customer-calc-basis-points"
            />
          </FormField>

          <FormField v-slot="{ field }" label="手数料 From" hint="円・下限額">
            <BaseInput
              v-bind="field"
              v-model="form.feeFrom"
              class="customer-calc__number"
              inputmode="numeric"
              autocomplete="off"
              data-testid="customer-calc-fee-from"
            />
          </FormField>

          <FormField v-slot="{ field }" label="手数料 To" hint="円・上限額">
            <BaseInput
              v-bind="field"
              v-model="form.feeTo"
              class="customer-calc__number"
              inputmode="numeric"
              autocomplete="off"
              data-testid="customer-calc-fee-to"
            />
          </FormField>
        </div>
      </section>

      <div class="customer-calc__actions">
        <RouterLink :to="backRoute" class="customer-calc__back" data-testid="customer-calc-back">
          戻る
        </RouterLink>
        <BaseButton type="submit" class="customer-calc__submit" data-testid="customer-calc-submit">
          仮計算を実行
        </BaseButton>
      </div>
    </form>

    <BaseCard title="仮計算結果" flush aria-live="polite" data-testid="customer-calc-result">
      <p class="customer-calc__caption" data-testid="customer-calc-result-caption">
        {{ estimateLabel }} ／ 未実行
      </p>

      <div class="customer-calc__result">
        <dl class="customer-calc__rows" data-testid="customer-calc-result-rows">
          <div v-for="row in resultRows" :key="row.key" class="customer-calc__row">
            <dt>{{ row.label }}</dt>
            <dd>{{ PLACEHOLDER }}</dd>
          </div>
        </dl>

        <div class="customer-calc__summary">
          <p class="customer-calc__total">
            <span data-testid="customer-calc-total-label">{{ totalLabel }}</span>
            <strong data-testid="customer-calc-total">{{ PLACEHOLDER }}</strong>
          </p>
          <!-- 取得金額と比べる損益は、預りを売るときだけ意味がある（モックも売却概算でだけ出す） -->
          <p v-if="isSell" class="customer-calc__profit-loss" data-testid="customer-calc-profit-loss">
            <span>概算損益（取得金額対比）</span>
            <strong>{{ PLACEHOLDER }}</strong>
          </p>
        </div>
      </div>

      <p class="customer-calc__source">
        仮計算マスタ：取引所税 {{ PLACEHOLDER }}% ／ スプレッド {{ PLACEHOLDER }}円/USD ／ 現地手数料率
        {{ PLACEHOLDER }}% ／ NISA仮計算用為替上乗せ率
        {{ PLACEHOLDER }}%。手入力した現地費用・取引税は自動補完より優先します。成長投資枠の買付概算は通常為替に上乗せ率を加えて計算します。実際の約定・受渡・手数料・税額を確定するものではありません。
      </p>
    </BaseCard>
  </div>
</template>

<style scoped>
.customer-calc {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 入力フォームの面（モックの .calc-form-grid）。区画は下線で区切る */
.customer-calc__form {
  padding: var(--space-3) var(--space-6) var(--space-2);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.customer-calc__section {
  margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.customer-calc__section-title {
  margin: 0;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 700;
}

.customer-calc__section-note {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}

.customer-calc__fields {
  display: grid;
  gap: var(--space-3) var(--space-4);
  align-items: start;
  padding: var(--space-3) 0;
}

/* 主項目。銘柄だけを 1 行目に置き、残りはモックの固定幅で 2 行目に並べる */
.customer-calc__fields.is-primary {
  grid-template-columns: 160px 160px 110px 135px 145px 135px;
  justify-content: start;
}

.customer-calc__symbol {
  grid-column: 1 / -1;
  max-width: 560px;
}

/* 現地費用は 6 列。手数料の 3 項目だけ 2 列ぶん取る */
.customer-calc__fields.is-local-fee {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.customer-calc__wide {
  grid-column: span 2;
}

.customer-calc__fields.is-fee-condition {
  grid-template-columns:
    minmax(220px, 1.5fr) minmax(110px, 0.75fr) minmax(130px, 0.85fr)
    minmax(150px, 1fr) minmax(150px, 1fr);
}

.customer-calc__number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* チェックボックスを隣の入力欄と同じ高さの行に置く */
.customer-calc__check {
  display: flex;
  align-items: center;
  min-height: 34px;
}

.customer-calc__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin: var(--space-4) 0 var(--space-2);
}

/* 「戻る」はリンクだが、見た目は secondary のボタンにそろえる */
.customer-calc__back {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: 500;
  text-decoration: none;
}

.customer-calc__back:hover {
  background-color: var(--color-bg);
}

.customer-calc__submit {
  font-weight: 700;
}

/* 結果のカード（モックの .calc-result）。左に明細行、右に合計 */
.customer-calc__caption {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  background-color: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
}

.customer-calc__result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
}

.customer-calc__rows {
  margin: 0;
  padding: var(--space-1) var(--space-4);
}

.customer-calc__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.customer-calc__row:last-child {
  border-bottom: 0;
}

.customer-calc__row dd {
  margin: 0;
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.customer-calc__summary {
  padding: var(--space-3) var(--space-4);
  border-left: 1px solid var(--color-border);
}

.customer-calc__total {
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-muted);
}

.customer-calc__total span {
  display: block;
  color: var(--color-label);
  font-size: var(--font-size-sm);
}

.customer-calc__total strong {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-heading);
  font-size: var(--font-size-2xl);
  line-height: 1.15;
}

.customer-calc__profit-loss {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: var(--space-3) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.customer-calc__profit-loss span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.customer-calc__profit-loss strong {
  font-size: var(--font-size-md);
}

.customer-calc__source {
  margin: 0 var(--space-4) var(--space-4);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

@media (max-width: 1040px) {
  .customer-calc__fields.is-primary,
  .customer-calc__fields.is-local-fee,
  .customer-calc__fields.is-fee-condition {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .customer-calc__wide {
    grid-column: span 1;
  }

  .customer-calc__result {
    grid-template-columns: 1fr;
  }

  .customer-calc__summary {
    border-top: 1px solid var(--color-border);
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .customer-calc__form {
    padding: var(--space-3) var(--space-4) var(--space-2);
  }

  .customer-calc__fields.is-primary,
  .customer-calc__fields.is-local-fee,
  .customer-calc__fields.is-fee-condition {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

<script setup>
/**
 * 新規注文の入力フォーム（モックリポジトリの order_input.html）。
 * 左列が注文の主項目、右列が受注情報で、その下に強制区分と送信ボタンが並ぶ。
 *
 * この部品は入力欄を並べて値を書き換えるだけで、状態は持たない。照会（口座番号・ティッカー）、
 * 検証、送信の可否は画面（views/OrderEntryView.vue）が決め、結果を props で受ける。
 *   - errors      … 項目ごとの入力の不備（utils/orderEntryForm.js の validateOrderForm の戻り値）
 *   - customerHint / symbolHint … 口座番号・ティッカーの横に出す照会結果
 *
 * 売買区分を選ぶと、フォームの面が売買の色（買い=赤 / 売り=青）に変わる（モックの .theme-buy）。
 */
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import FormField from '@/components/ui/FormField.vue'
import {
  CASH_DELIVERY_OPTIONS,
  DEPOSIT_CATEGORY_OPTIONS,
  EXECUTION_SCOPE_OPTIONS,
  FUND_NATURE_OPTIONS,
  ORDER_CHANNEL_OPTIONS,
  ORDER_METHOD_OPTIONS,
  ORDER_TYPE,
  ORDER_TYPE_OPTIONS,
  SETTLEMENT_CURRENCY_OPTIONS,
  SIDE,
  SIDE_OPTIONS,
  SOLICITATION_OPTIONS,
  VWAP_OPTIONS,
} from '@/utils/orderEntryOptions'
import {
  formatOrderDateInput,
  formatOrderTimeInput,
  formatQuantityInput,
} from '@/utils/orderEntryForm'

defineProps({
  /** 項目ごとの入力の不備。キーはフォームの項目名 */
  errors: {
    type: Object,
    default: () => ({}),
  },
  /** 期間指定の選択肢（utils/orderEntryForm.js の buildExpiryOptions） */
  expiryOptions: {
    type: Array,
    required: true,
  },
  /** 口座番号の横の表示。tone は 'found' / 'not-found' / 'muted'（空文字なら何も出さない） */
  customerHint: {
    type: Object,
    default: () => ({ text: '', tone: '' }),
  },
  /** ティッカーの横の表示。形は customerHint と同じ */
  symbolHint: {
    type: Object,
    default: () => ({ text: '', tone: '' }),
  },
  /** フロコン警告が出ているか（強制区分の横に「確認の上チェック」を出す） */
  warned: {
    type: Boolean,
    default: false,
  },
  /** 送信を受け付けない（発注権限なし・発注停止中） */
  disabled: {
    type: Boolean,
    default: false,
  },
  /** 送信中（事前検証の応答待ち） */
  submitting: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['submit'])

/** フォームの値。オブジェクトごと v-model する（項目が 20 あり、1 つずつ受けると props が膨らむ） */
const form = defineModel({ type: Object, required: true })

const isLimit = computed(() => form.value.orderType === ORDER_TYPE.LIMIT)

const themeClass = computed(() => {
  if (form.value.side === SIDE.BUY) return 'is-buy'
  if (form.value.side === SIDE.SELL) return 'is-sell'
  return ''
})

/*
 * 入力しながら整形する欄（数量のカンマ、受注日の /、受注時刻の :、ティッカーの大文字）。
 * 整形後の値が前と同じだと Vue は入力欄を描き直さず、打った文字（数字以外など）が残る。
 * そこで v-model（打ったままの値）のあとに届く input イベントで、欄の表示を直接書き換え、
 * 整形後の値をフォームに入れ直す（v-model のリスナーは要素に先に付くので、こちらが後に走る）。
 */
function reformat(event, key, format) {
  // IME の変換中は触らない（確定時に v-model が input を送り直すので、そこで整形される）
  if (event.isComposing) return
  const formatted = format(event.target.value)
  event.target.value = formatted
  form.value[key] = formatted
}

const toUpperCase = (value) => value.toUpperCase()

// 成行へ戻したら指値を消す（隠れた欄に古い値を残して送らない。モックの setPriceType と同じ）
function selectOrderType(value) {
  form.value.orderType = value
  if (value !== ORDER_TYPE.LIMIT) form.value.limitPrice = ''
}
</script>

<template>
  <!--
    novalidate: required は必須マークと aria のためのもの。ブラウザ標準の吹き出し（英語）に
    先を越されないよう、検証は画面の submit に任せる
  -->
  <form
    :class="['order-entry-form', themeClass]"
    data-testid="order-entry-form"
    novalidate
    @submit.prevent="emit('submit')"
  >
    <slot name="customer" />

    <div class="order-entry-form__grid">
      <div class="order-entry-form__primary">
        <FormField
          v-slot="{ field }"
          label="部店"
          layout="inline"
          required
          :error="errors.branchCode"
        >
          <BaseInput
            v-bind="field"
            v-model="form.branchCode"
            variant="underline"
            class="order-entry-form__code"
            inputmode="numeric"
            autocomplete="off"
            data-testid="order-entry-branch"
          />
        </FormField>

        <FormField
          v-slot="{ field }"
          label="口座番号"
          layout="inline"
          required
          :error="errors.accountNumber"
        >
          <BaseInput
            v-bind="field"
            v-model="form.accountNumber"
            variant="underline"
            class="order-entry-form__code"
            inputmode="numeric"
            autocomplete="off"
            data-testid="order-entry-account"
          />
          <span
            v-if="customerHint.text"
            :class="['order-entry-form__hint', `is-${customerHint.tone}`]"
            data-testid="order-entry-account-hint"
          >
            {{ customerHint.text }}
          </span>
        </FormField>

        <FormField
          v-slot="{ field }"
          label="ティッカーコード"
          layout="inline"
          required
          :error="errors.ticker"
        >
          <BaseInput
            v-bind="field"
            v-model="form.ticker"
            variant="underline"
            class="order-entry-form__code"
            autocomplete="off"
            data-testid="order-entry-ticker"
            @input="reformat($event, 'ticker', toUpperCase)"
          />
          <span
            v-if="symbolHint.text"
            :class="['order-entry-form__hint', `is-${symbolHint.tone}`]"
            data-testid="order-entry-ticker-hint"
          >
            {{ symbolHint.text }}
          </span>
        </FormField>

        <!-- ボタンの並びなので label 要素と結び付けられない。名前は aria-label で持たせる -->
        <FormField label="売買区分（委託）" layout="inline" required :error="errors.side">
          <BaseSegmentedControl
            v-model="form.side"
            :options="SIDE_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="売買区分（委託）"
            data-testid="order-entry-side"
          />
        </FormField>

        <FormField v-slot="{ field }" label="市場区分" layout="inline" required>
          <BaseSelect
            v-bind="field"
            v-model="form.executionScope"
            :options="EXECUTION_SCOPE_OPTIONS"
            variant="underline"
            class="order-entry-form__market"
            data-testid="order-entry-execution-scope"
          />
        </FormField>

        <FormField
          v-slot="{ field }"
          label="注文数量"
          layout="inline"
          required
          :error="errors.quantity"
        >
          <BaseInput
            v-bind="field"
            v-model="form.quantity"
            variant="underline"
            class="order-entry-form__number"
            inputmode="numeric"
            autocomplete="off"
            data-testid="order-entry-quantity"
            @input="reformat($event, 'quantity', formatQuantityInput)"
          />
          <span class="order-entry-form__unit">株</span>
        </FormField>

        <FormField label="価格" layout="inline" required :error="errors.limitPrice">
          <BaseSegmentedControl
            :model-value="form.orderType"
            :options="ORDER_TYPE_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="価格"
            data-testid="order-entry-order-type"
            @update:model-value="selectOrderType"
          />
          <template v-if="isLimit">
            <BaseInput
              v-model="form.limitPrice"
              variant="underline"
              class="order-entry-form__number"
              inputmode="decimal"
              placeholder="0.0000"
              autocomplete="off"
              aria-label="指値価格"
              :invalid="Boolean(errors.limitPrice)"
              data-testid="order-entry-limit-price"
            />
            <span class="order-entry-form__unit">USD</span>
          </template>
        </FormField>

        <FormField
          v-slot="{ field }"
          label="期間指定"
          layout="inline"
          required
          :error="errors.expiryDate"
        >
          <BaseSelect
            v-bind="field"
            v-model="form.expiryDate"
            :options="expiryOptions"
            variant="underline"
            class="order-entry-form__expiry"
            data-testid="order-entry-expiry"
          />
        </FormField>

        <FormField label="決済通貨区分" layout="inline" required>
          <BaseSegmentedControl
            v-model="form.settlementCurrency"
            :options="SETTLEMENT_CURRENCY_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="決済通貨区分"
            data-testid="order-entry-settlement-currency"
          />
        </FormField>

        <FormField label="預り売買区分" layout="inline" :error="errors.depositCategory">
          <BaseSegmentedControl
            v-model="form.depositCategory"
            :options="DEPOSIT_CATEGORY_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="預り売買区分"
            data-testid="order-entry-deposit-category"
          />
        </FormField>
      </div>

      <div class="order-entry-form__reception">
        <FormField v-slot="{ field }" label="受注日" layout="inline" :error="errors.orderDate">
          <BaseInput
            v-bind="field"
            v-model="form.orderDate"
            variant="underline"
            class="order-entry-form__short"
            inputmode="numeric"
            maxlength="5"
            placeholder="08/25"
            autocomplete="off"
            data-testid="order-entry-order-date"
            @input="reformat($event, 'orderDate', formatOrderDateInput)"
          />
        </FormField>

        <FormField v-slot="{ field }" label="受注時刻" layout="inline" :error="errors.orderTime">
          <BaseInput
            v-bind="field"
            v-model="form.orderTime"
            variant="underline"
            class="order-entry-form__short"
            inputmode="numeric"
            maxlength="5"
            placeholder="11:25"
            autocomplete="off"
            data-testid="order-entry-order-time"
            @input="reformat($event, 'orderTime', formatOrderTimeInput)"
          />
        </FormField>

        <FormField v-slot="{ field }" label="受注者" layout="inline" :error="errors.orderPerson">
          <BaseInput
            v-bind="field"
            v-model="form.orderPerson"
            variant="underline"
            class="order-entry-form__short"
            autocomplete="off"
            data-testid="order-entry-order-person"
          />
        </FormField>

        <FormField label="勧誘区分" layout="inline">
          <BaseSegmentedControl
            v-model="form.solicitation"
            :options="SOLICITATION_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="勧誘区分"
            data-testid="order-entry-solicitation"
          />
        </FormField>

        <FormField label="受注方法" layout="inline">
          <BaseSegmentedControl
            v-model="form.orderMethod"
            :options="ORDER_METHOD_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="受注方法"
            data-testid="order-entry-order-method"
          />
        </FormField>

        <FormField label="資金性格" layout="inline">
          <BaseSegmentedControl
            v-model="form.fundNature"
            :options="FUND_NATURE_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="資金性格"
            data-testid="order-entry-fund-nature"
          />
        </FormField>

        <FormField label="注文チャネル" layout="inline">
          <BaseSegmentedControl
            v-model="form.orderChannel"
            :options="ORDER_CHANNEL_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="注文チャネル"
            data-testid="order-entry-order-channel"
          />
        </FormField>

        <FormField label="金銭受渡方法" layout="inline">
          <BaseSegmentedControl
            v-model="form.cashDelivery"
            :options="CASH_DELIVERY_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="金銭受渡方法"
            data-testid="order-entry-cash-delivery"
          />
        </FormField>

        <FormField label="注文種別" layout="inline" :error="errors.vwap">
          <BaseSegmentedControl
            v-model="form.vwap"
            :options="VWAP_OPTIONS"
            class="order-entry-form__toggle"
            aria-label="注文種別"
            data-testid="order-entry-vwap"
          />
        </FormField>
      </div>
    </div>

    <FormField v-slot="{ field }" label="強制区分" layout="inline" class="order-entry-form__forced">
      <!-- BaseCheckbox は invalid を props に持たないので、field は id だけを渡す -->
      <BaseCheckbox :id="field.id" v-model="form.forced" data-testid="order-entry-forced" />
      <span v-if="warned" class="order-entry-form__forced-note" data-testid="order-entry-forced-note">
        フロコン警告あり — 確認の上チェック
      </span>
    </FormField>

    <div class="order-entry-form__actions">
      <BaseButton
        type="submit"
        class="order-entry-form__submit"
        :disabled="disabled || submitting"
        :loading="submitting"
        data-testid="order-entry-submit"
      >
        {{ submitting ? '確認中…' : '送信' }}
      </BaseButton>
    </div>
  </form>
</template>

<style scoped>
/* モックの .fsk-form。売買を選ぶと面と区切り線の色が変わる */
.order-entry-form {
  --order-entry-line: var(--color-border);

  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6) var(--space-3);
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  transition: background-color 0.3s ease;
}

.order-entry-form.is-buy {
  --order-entry-line: var(--color-buy-line);

  background-color: var(--color-buy-bg);
}

.order-entry-form.is-sell {
  --order-entry-line: var(--color-sell-line);

  background-color: var(--color-sell-bg);
}

/* 左列 550px・右列は残り（モックの .order-work-grid。狭い幅では 1 列に畳む） */
.order-entry-form__grid {
  display: grid;
  grid-template-columns: 550px minmax(0, 1fr);
  gap: 0 var(--space-6);
}

.order-entry-form__primary,
.order-entry-form__reception {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.order-entry-form__reception {
  padding-left: var(--space-5);
  border-left: 1px solid var(--order-entry-line);
}

@media (max-width: 1179px) {
  .order-entry-form__grid {
    grid-template-columns: 1fr;
  }

  .order-entry-form__reception {
    margin-top: var(--space-3);
    padding: var(--space-3) 0 0;
    border-top: 1px solid var(--order-entry-line);
    border-left: 0;
  }
}

/* 入力欄の幅はモックの指定どおり */
.order-entry-form__code {
  width: 160px;
  text-transform: uppercase;
}

.order-entry-form__number {
  width: 120px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.order-entry-form__short {
  width: 120px;
  font-variant-numeric: tabular-nums;
}

.order-entry-form__market {
  width: 300px;
}

.order-entry-form__expiry {
  width: 210px;
}

.order-entry-form__unit {
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
}

/* 照会結果のヒント（見つかった名前は青、見つからないときは赤） */
.order-entry-form__hint {
  min-width: 100px;
  font-size: var(--font-size-md);
  font-weight: 600;
}

.order-entry-form__hint.is-found {
  color: var(--color-info-text);
}

.order-entry-form__hint.is-not-found {
  color: var(--color-danger-text);
}

.order-entry-form__hint.is-muted {
  color: var(--color-text-muted);
  font-weight: 400;
}

.order-entry-form__forced-note {
  color: var(--color-warning);
  font-size: var(--font-size-xs);
}

.order-entry-form__actions {
  display: flex;
  justify-content: center;
  padding-top: var(--space-2);
}

/* モックの .btn-submit（幅を広く取った主ボタン）。文言が「確認中…」に変わっても幅が動かない */
.order-entry-form__submit {
  min-width: 240px;
}
</style>

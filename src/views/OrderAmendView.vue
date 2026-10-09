<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import FormField from '@/components/ui/FormField.vue'
import { useOrderActionStore } from '@/stores/orderAction'
import { formatMonthDayTime, formatQuantity } from '@/utils/format'
import { formatQuantityInput } from '@/utils/orderEntryForm'
import { DEPOSIT_CATEGORY_OPTIONS } from '@/utils/orderEntryOptions'
import {
  AMEND_MARKET_SCOPE_OPTIONS,
  ORDER_TYPE_OPTIONS,
  orderPriceLabel,
  orderStatusLabel,
} from '@/utils/orderTypes'

/*
 * 外株注文訂正（/orders/:orderId/amend。画面モック `order_amend.html`）。
 * 注文照会の「訂正」から入る。発注権限の無い利用者はルートのガードで入れない。
 *
 * 対象注文は画面を開くたびに GET /orders/{order_id} で読み直す（一覧から行を受け渡さない）。
 * URL を直接開いても表示でき、いまの状況で訂正の可否を判断できる。
 *
 * 画面モックからの意図的なずれ:
 *   - 執行条件（有効期限）は現在の値を見せるだけで変えられない。訂正 API（AmendOrderRequest）が
 *     受けるのは数量・指値単価・指成区分・発注範囲・理由だけ（docs/api/requests.md #65 で依頼中）
 *   - 訂正できる状況は API に合わせる（モックは「Dream登録待ち」だけ、API は 未発注 / 注文中 / 一部出来）
 *   - 登録後は受付完了の共通画面へ飛ばず、この画面を完了表示に切り替える（共通画面がまだ無い）
 *   - 入力の不備は画面上部の一覧ではなく、項目ごとに出す（新規注文の入力と同じ）
 *   - 訂正理由の maxlength はモックの 100 ではなく実 API（AmendOrderRequest の 理由）の 200
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrderActionStore()
const { order, loading, error, amendResult, amending, amendError } = storeToRefs(store)
const route = useRoute()
const router = useRouter()

// ルートの注文 ID が変わるたびに読み直す。画面を離れるときの undefined は読まない
watch(
  () => route.params.orderId,
  (id) => {
    if (id) store.load(String(id))
  },
  { immediate: true },
)

/** 404 は「注文が無い」（空の状態）として、再試行ではなく注文照会へ戻る導線を出す */
const notFound = computed(() => error.value?.status === 404)

const sideLabels = { buy: '買', sell: '売' }

/*
 * 「訂正対象注文」の 4 枠（顧客 / 銘柄 / 売買・預り / 原注文）に出す文言。
 * 預り売買区分は知らないコードならコードのまま出し、無ければ出さない。
 */
const depositLabel = computed(() => {
  const code = order.value?.depositCategory
  if (!code) return ''
  return DEPOSIT_CATEGORY_OPTIONS.find((option) => option.value === code)?.label ?? code
})

const originalLabel = computed(() => {
  const target = order.value
  if (!target) return ''
  return `${formatQuantity(target.quantity)}株 ／ ${orderPriceLabel(target.orderType, target.limitPrice)}`
})

/**
 * 執行条件（有効期限）の表示。受注日と同じ日なら「当日中（9/28）」、違えば「10/1 まで」
 * （モックの選択肢は「N営業日後（10/14）」だが、営業日の数え直しには休場日の暦が要るので日付だけ出す）。
 */
const expiryLabel = computed(() => {
  const expiry = order.value?.expiryDate
  if (!expiry) return '—'
  const [, month, day] = expiry.split('-').map(Number)
  const date = `${month}/${day}`
  return expiry === order.value.orderedAt.slice(0, 10) ? `当日中（${date}）` : `${date} まで`
})

/*
 * 入力欄。対象注文を読むたびにその注文の現在値へ洗い替える（別の注文の入力を持ち越さない）。
 * 数量と単価は入力途中の文字列のまま持ち、送るときに数値へ直す。数量はモックと同じく 3 桁ごとに
 * カンマを入れて見せる。
 */
const quantityInput = ref('')
const orderTypeInput = ref('')
const limitPriceInput = ref('')
const marketScopeInput = ref('')
const reasonInput = ref('')
const errors = ref({ quantity: '', limitPrice: '', form: '' })

watch(
  order,
  (target) => {
    if (!target) return
    quantityInput.value = target.quantity == null ? '' : formatQuantity(target.quantity)
    orderTypeInput.value = target.orderType
    limitPriceInput.value = target.limitPrice == null ? '' : String(target.limitPrice)
    marketScopeInput.value = target.marketScope
    reasonInput.value = ''
    errors.value = { quantity: '', limitPrice: '', form: '' }
  },
  { immediate: true },
)

const isLimit = computed(() => orderTypeInput.value === 'LO')

/*
 * 数量は打つそばから整形する（数字以外を落とし、3 桁ごとにカンマ。モックの formatQuantity）。
 * 整形後の値が前と同じだと Vue は入力欄を描き直さないので、欄の表示も直接書き換える
 * （OrderEntryForm の reformat と同じ）。
 */
function reformatQuantity(event) {
  // IME の変換中は触らない（確定時に v-model が input を送り直すので、そこで整形される）
  if (event.isComposing) return
  const formatted = formatQuantityInput(event.target.value)
  event.target.value = formatted
  quantityInput.value = formatted
}

// 成行へ戻したら指値を消す（隠れた欄に古い値を残さない。モックの価格トグルと同じ）
function selectOrderType(value) {
  orderTypeInput.value = value
  if (value !== 'LO') limitPriceInput.value = ''
}

/** 一部出来の注文では、入力するのが出来分を含む総数量であることを添える */
const quantityHint = computed(() => {
  const filled = order.value?.filledQuantity ?? 0
  return filled > 0 ? `出来数量 ${formatQuantity(filled)}株を含む総数量` : ''
})

/*
 * 市場区分のボタン。知らないコードの注文を開いたときは、そのコードもボタンに足す
 * （足さないとどれも選ばれていない表示になり、何も変えていないのに区分が消えたように見える）。
 */
const marketScopeOptions = computed(() => {
  const current = order.value?.marketScope
  if (!current || AMEND_MARKET_SCOPE_OPTIONS.some((option) => option.value === current)) {
    return AMEND_MARKET_SCOPE_OPTIONS
  }
  return [...AMEND_MARKET_SCOPE_OPTIONS, { value: current, label: current }]
})

/** 処理状況の名前。サーバの 処理状況名 を使い、無い応答のときだけコードの写しで引く */
const statusLabel = computed(() => order.value?.statusName || orderStatusLabel(order.value?.status))

/** 訂正できない状況のときは、フォームを押せなくして理由を出す */
const locked = computed(() => !order.value?.amendable)

/**
 * 注文数量の検査。数量は出来分を含む総数量で、IB へは「総数量 − 出来数量」が発注されるので、
 * 出来数量以下にはできない。
 */
function quantityError(value, filled) {
  if (value === '') return '注文数量を入力してください。'
  if (!/^\d+$/.test(value)) return '注文数量を整数で入力してください。'
  const quantity = Number(value)
  if (quantity <= 0) return '注文数量は1以上で入力してください。'
  if (quantity <= filled) {
    return `注文数量は出来数量（${formatQuantity(filled)}株）より大きい数を入力してください。`
  }
  return ''
}

/** 指値価格の検査。文言は画面モックの入力チェックに合わせる */
function limitPriceError(value) {
  if (value === '') return '指値価格を入力してください。'
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
    return '指値価格は0より大きい数値を入力してください。'
  }
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return '指値には、「小数点第４位以内」で入力してください。'
  return ''
}

/**
 * 変えた項目だけを集める。訂正 API は部分更新で、本文に含めた項目だけを変える。
 * 成行へ変えるときは単価を載せない（API の説明「成行(MO)へ変更する場合は不要」）。
 */
function collectChanges(target, quantity, limitPrice) {
  const changes = {}
  if (quantity !== target.quantity) changes.quantity = quantity
  if (orderTypeInput.value !== target.orderType) changes.orderType = orderTypeInput.value
  if (isLimit.value && limitPrice !== target.limitPrice) changes.limitPrice = limitPrice
  if (marketScopeInput.value !== target.marketScope) changes.marketScope = marketScopeInput.value
  return changes
}

async function submit() {
  const target = order.value
  // 送信ボタンは :disabled で塞いであるが、入力欄での Enter でも submit は飛ぶ
  if (!target || locked.value || amending.value) return

  // 桁区切りのカンマは表示のためのもの（送るときは数値にする）
  const quantityText = quantityInput.value.replaceAll(',', '').trim()
  const limitPriceText = limitPriceInput.value.trim()

  errors.value = {
    quantity: quantityError(quantityText, target.filledQuantity),
    limitPrice: isLimit.value ? limitPriceError(limitPriceText) : '',
    form: '',
  }
  if (errors.value.quantity || errors.value.limitPrice) return

  const changes = collectChanges(target, Number(quantityText), Number(limitPriceText))
  if (Object.keys(changes).length === 0) {
    errors.value.form = '変更された項目がありません。'
    return
  }

  const reason = reasonInput.value.trim()
  // 失敗時は入力をそのまま残して直させる（理由は amendError に出る）
  await store.amend(reason ? { ...changes, reason } : changes)
}

/*
 * 戻る。注文照会から来たなら履歴を戻る（検索条件とページ位置を残したまま一覧へ帰れる）。
 * URL を直接開いたときは戻る先が無いので、注文照会を開く。
 */
function goBack() {
  if (router.options.history.state?.back) router.back()
  else router.push({ name: 'order-inquiry' })
}
</script>

<template>
  <section class="order-amend">
    <!-- ローディング / エラー / 空（注文が無い） / データあり の 4 状態 -->
    <p v-if="loading" data-testid="order-amend-loading" class="order-amend__status is-loading">
      <BaseSpinner />
    </p>

    <div v-else-if="notFound" data-testid="order-amend-not-found" class="order-amend__status">
      <p>注文が見つかりませんでした。</p>
      <BaseButton variant="secondary" @click="goBack">注文照会へ戻る</BaseButton>
    </div>

    <div
      v-else-if="error"
      data-testid="order-amend-error"
      class="order-amend__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="store.reload()">再試行</BaseButton>
    </div>

    <!-- 訂正の受付後は完了表示に切り替える。結果の文言はサーバが決める -->
    <BaseCard v-else-if="amendResult" title="訂正の受付" data-testid="order-amend-complete">
      <div class="order-amend__complete">
        <BaseAlert variant="success" data-testid="order-amend-complete-message">
          {{ amendResult.message || '訂正を受け付けました。' }}
        </BaseAlert>

        <p v-if="amendResult.mode === 'cancelReplace'" data-testid="order-amend-complete-detail">
          原注文 #{{ amendResult.originalOrderId }} の取消を依頼し、訂正注文 #{{
            amendResult.amendmentOrderId
          }}
          を受け付けました。原注文の取消が完了すると、訂正注文が発注されます。
        </p>
        <p v-else-if="amendResult.mode === 'inPlace'" data-testid="order-amend-complete-detail">
          未発注の注文 #{{ amendResult.originalOrderId }} をその場で訂正しました。
        </p>

        <BaseAlert
          v-if="amendResult.warnings.length > 0"
          variant="warning"
          data-testid="order-amend-complete-warnings"
        >
          <ul class="order-amend__messages">
            <li v-for="message in amendResult.warnings" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <div class="order-amend__actions">
          <BaseButton data-testid="order-amend-back-to-list" @click="goBack">
            注文照会へ戻る
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <template v-else-if="order">
      <BaseAlert variant="warning" class="order-amend__notice" data-testid="order-amend-notice">
        <strong>訂正対象</strong>
        <span>
          未発注・注文中・一部出来の注文を訂正できます。発注済みの注文は原注文を取り消し、訂正注文として受け付けます（原注文の取消が完了すると発注されます）。
        </span>
      </BaseAlert>

      <BaseCard title="訂正対象注文">
        <template #header-actions>
          <BaseBadge variant="warning" data-testid="order-amend-status">
            {{ statusLabel }}
          </BaseBadge>
        </template>

        <!-- モックの 4 枠（顧客 / 銘柄 / 売買・預り / 原注文）。枠ごとに見出し・値・添え書き -->
        <dl class="order-amend__reference" data-testid="order-amend-summary">
          <div class="order-amend__reference-item">
            <dt>顧客</dt>
            <dd>
              <span class="order-amend__value" data-testid="order-amend-customer">
                {{ order.customerName || '—' }}
              </span>
              <span class="order-amend__sub" data-testid="order-amend-account">
                部店 {{ order.branchCode || '—' }} ／ 口座 {{ order.accountNumber || '—' }}
              </span>
            </dd>
          </div>
          <div class="order-amend__reference-item">
            <dt>銘柄</dt>
            <dd>
              <span class="order-amend__value is-symbol" data-testid="order-amend-symbol">
                {{ order.symbol || '—' }}
              </span>
              <span
                v-if="order.symbolName"
                class="order-amend__sub"
                data-testid="order-amend-symbol-name"
              >
                {{ order.symbolName }}
              </span>
            </dd>
          </div>
          <div class="order-amend__reference-item">
            <dt>売買・預り</dt>
            <dd>
              <span
                :class="['order-amend__value', `is-${order.side}`]"
                data-testid="order-amend-side"
              >
                {{ sideLabels[order.side] ?? '—' }}
              </span>
              <span
                v-if="depositLabel"
                class="order-amend__deposit"
                data-testid="order-amend-deposit"
              >
                {{ depositLabel }}
              </span>
            </dd>
          </div>
          <div class="order-amend__reference-item">
            <dt>原注文</dt>
            <dd>
              <span class="order-amend__value" data-testid="order-amend-original">
                {{ originalLabel }}
              </span>
              <span class="order-amend__sub" data-testid="order-amend-ordered-at">
                受注 {{ formatMonthDayTime(order.orderedAt) }}
              </span>
            </dd>
          </div>
        </dl>
      </BaseCard>

      <BaseCard title="訂正内容">
        <template #header-actions>
          <span class="order-amend__note">基本情報・売買区分・預り区分は変更できません</span>
        </template>

        <BaseAlert v-if="locked" variant="warning" data-testid="order-amend-locked">
          この注文は訂正できません（処理状況: {{ statusLabel }}）。
        </BaseAlert>

        <!--
          novalidate: required は必須マークと aria のためのもの。ブラウザ標準の吹き出し（英語）に
          先を越されて空欄の文言が出なくならないよう、検証は submit に任せる
        -->
        <form
          v-else
          class="order-amend__form"
          data-testid="order-amend-form"
          novalidate
          @submit.prevent="submit"
        >
          <BaseAlert v-if="amendError" variant="error" data-testid="order-amend-submit-error">
            {{ amendError.message }}
          </BaseAlert>
          <BaseAlert v-if="errors.form" variant="error" data-testid="order-amend-form-error">
            {{ errors.form }}
          </BaseAlert>

          <div class="order-amend__grid">
            <FormField
              v-slot="{ field }"
              label="注文数量"
              required
              :hint="quantityHint"
              :error="errors.quantity"
            >
              <div class="order-amend__with-unit">
                <BaseInput
                  v-bind="field"
                  v-model="quantityInput"
                  class="order-amend__quantity"
                  inputmode="numeric"
                  autocomplete="off"
                  data-testid="order-amend-quantity"
                  @input="reformatQuantity"
                />
                <span class="order-amend__unit">株</span>
              </div>
            </FormField>

            <!-- ボタンの並びなので label 要素と結び付けられない。名前は aria-label で持たせる -->
            <FormField label="市場区分" required>
              <BaseSegmentedControl
                v-model="marketScopeInput"
                :options="marketScopeOptions"
                class="order-amend__toggle"
                aria-label="市場区分"
                data-testid="order-amend-market-scope"
              />
            </FormField>

            <!-- 指値価格の欄はトグルの下。検査の文言は価格の欄の下に出す -->
            <FormField v-slot="{ field }" label="価格" required :error="errors.limitPrice">
              <BaseSegmentedControl
                :model-value="orderTypeInput"
                :options="ORDER_TYPE_OPTIONS"
                aria-label="価格"
                data-testid="order-amend-order-type"
                @update:model-value="selectOrderType"
              />
              <div v-if="isLimit" class="order-amend__with-unit order-amend__price">
                <BaseInput
                  v-bind="field"
                  v-model="limitPriceInput"
                  class="order-amend__limit-price"
                  inputmode="decimal"
                  placeholder="0.0000"
                  autocomplete="off"
                  aria-label="指値価格"
                  data-testid="order-amend-limit-price"
                />
                <span class="order-amend__unit">USD</span>
              </div>
            </FormField>

            <!-- 訂正 API が有効期限を受けないので、いまの値を見せるだけ -->
            <FormField v-slot="{ field }" label="執行条件" hint="訂正では変更できません">
              <BaseSelect
                v-bind="field"
                :model-value="expiryLabel"
                :options="[{ value: expiryLabel, label: expiryLabel }]"
                disabled
                data-testid="order-amend-expiry"
              />
            </FormField>

            <!-- maxlength は実 API（AmendOrderRequest の 理由）の 200 文字に合わせる -->
            <FormField v-slot="{ field }" label="訂正理由（任意）" class="order-amend__full">
              <BaseInput
                v-bind="field"
                v-model="reasonInput"
                maxlength="200"
                placeholder="例：お客様から価格変更の申出"
                data-testid="order-amend-reason"
              />
            </FormField>
          </div>

          <div class="order-amend__actions">
            <BaseButton
              variant="secondary"
              data-testid="order-amend-back"
              :disabled="amending"
              @click="goBack"
            >
              戻る
            </BaseButton>
            <BaseButton
              type="submit"
              data-testid="order-amend-submit"
              :disabled="amending"
              :loading="amending"
            >
              {{ amending ? '登録中…' : '訂正を登録' }}
            </BaseButton>
          </div>
        </form>

        <div v-if="locked" class="order-amend__actions">
          <BaseButton variant="secondary" data-testid="order-amend-back" @click="goBack">
            戻る
          </BaseButton>
        </div>
      </BaseCard>
    </template>
  </section>
</template>

<style scoped>
/* 幅はモックの .amend-layout（960px）で止める */
.order-amend {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 960px;
}

/* モックの .amend-notice。見出し語を太字で前に置き、左端の線を太くする */
.order-amend .order-amend__notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-left: 4px solid var(--color-warning);
  font-size: var(--font-size-sm);
}

.order-amend__notice > strong {
  flex-shrink: 0;
}

.order-amend__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* モックの .amend-reference-grid。4 枠を横に並べ、狭い幅では 2 列 → 1 列に畳む */
.order-amend__reference {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.order-amend__reference-item {
  min-height: 62px;
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-surface-muted);
  border-right: 1px solid var(--color-border);
}

.order-amend__reference-item:last-child {
  border-right: 0;
}

.order-amend__reference dt {
  margin-bottom: var(--space-1);
  color: var(--color-label);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.order-amend__reference dd {
  margin: 0;
}

.order-amend__value {
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.order-amend__value.is-symbol {
  color: var(--color-link);
}

.order-amend__value.is-buy {
  color: var(--color-buy);
}

.order-amend__value.is-sell {
  color: var(--color-sell);
}

.order-amend__sub {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.order-amend__deposit {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

@media (max-width: 800px) {
  .order-amend__reference {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .order-amend__reference-item:nth-child(2) {
    border-right: 0;
  }

  .order-amend__reference-item:nth-child(-n + 2) {
    border-bottom: 1px solid var(--color-border);
  }
}

.order-amend__form,
.order-amend__complete {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.order-amend__complete > p {
  margin: 0;
}

/* モックの .amend-form-grid（2 列。訂正理由だけ全幅） */
.order-amend__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4) var(--space-6);
  align-items: start;
}

.order-amend__full {
  grid-column: 1 / -1;
}

@media (max-width: 600px) {
  .order-amend__grid,
  .order-amend__reference {
    grid-template-columns: 1fr;
  }

  .order-amend__reference-item {
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .order-amend__reference-item:last-child {
    border-bottom: 0;
  }
}

/* 入力欄の後ろに単位（株 / USD）を添える */
.order-amend__with-unit {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.order-amend__price {
  margin-top: var(--space-2);
}

.order-amend__unit {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 入力欄の幅はモックの指定どおり（数量 220px・右寄せ / 指値 180px） */
.order-amend__quantity {
  max-width: 220px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.order-amend__limit-price {
  max-width: 180px;
  font-variant-numeric: tabular-nums;
}

/* 市場区分の 4 ボタンは半分の幅に収まらないので、モックと同じく折り返す */
.order-amend__toggle {
  flex-wrap: wrap;
}

/* 戻る（左）と登録（右）。破壊的でない主操作を右端に置く */
.order-amend__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

/* 警告の箇条書き。1 件のときも体裁が浮かないよう、記号と字下げは付けない */
.order-amend__messages {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ（SliceCriteriaMasterView と同じ） */
.order-amend__status {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.order-amend__status > p {
  margin: 0;
}

/* スピナーだけを置くので中央に寄せる */
.order-amend__status.is-loading {
  justify-content: center;
}

.order-amend__status.is-error {
  color: var(--color-danger);
}
</style>

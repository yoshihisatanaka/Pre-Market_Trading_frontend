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
import FormGrid from '@/components/ui/FormGrid.vue'
import OrderDetailSummary from '@/components/orders/OrderDetailSummary.vue'
import { useOrderActionStore } from '@/stores/orderAction'
import { formatMonthDayTime, formatQuantity } from '@/utils/format'
import {
  MARKET_SCOPE_OPTIONS,
  ORDER_TYPE_OPTIONS,
  marketScopeLabel,
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
 *   - 執行条件（有効期限）の欄は置かない。訂正 API（AmendOrderRequest）が受けるのは
 *     数量・指値単価・指成区分・発注範囲・理由だけ
 *   - 訂正できる状況は API に合わせる（モックは「Dream登録待ち」だけ、API は 未発注 / 注文中 / 一部出来）
 *   - 登録後は受付完了の共通画面へ飛ばず、この画面を完了表示に切り替える（共通画面がまだ無い）
 *   - 市場区分は 6 区分をプルダウンで選ぶ（モックの 4 択のトグルはコードの体系と合っていない）
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

/** 「訂正対象注文」の中身。値はすべて表示用に整形済みの文字列 */
const summaryItems = computed(() => {
  const target = order.value
  if (!target) return []

  return [
    { label: '注文ID', value: `#${target.id}` },
    {
      label: '顧客',
      value: [
        target.customerName,
        `部店 ${target.branchCode || '—'} ／ 口座 ${target.accountNumber || '—'}`,
      ]
        .filter(Boolean)
        .join(' '),
      testid: 'order-amend-customer',
    },
    { label: '銘柄', value: target.symbol || '—' },
    { label: '売買', value: sideLabels[target.side] ?? '—' },
    {
      label: '原注文',
      value: `${formatQuantity(target.quantity)}株 ／ ${orderPriceLabel(target.orderType, target.limitPrice)}`,
      testid: 'order-amend-original',
    },
    { label: '市場区分', value: marketScopeLabel(target.marketScope) },
    { label: '出来数量', value: `${formatQuantity(target.filledQuantity)}株` },
    { label: '受注日時', value: formatMonthDayTime(target.orderedAt) },
  ]
})

/*
 * 入力欄。対象注文を読むたびにその注文の現在値へ洗い替える（別の注文の入力を持ち越さない）。
 * 数量と単価は入力途中の文字列のまま持ち、送るときに数値へ直す。
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
    quantityInput.value = target.quantity == null ? '' : String(target.quantity)
    orderTypeInput.value = target.orderType
    limitPriceInput.value = target.limitPrice == null ? '' : String(target.limitPrice)
    marketScopeInput.value = target.marketScope
    reasonInput.value = ''
    errors.value = { quantity: '', limitPrice: '', form: '' }
  },
  { immediate: true },
)

const isLimit = computed(() => orderTypeInput.value === 'LO')

/** 一部出来の注文では、入力するのが出来分を含む総数量であることを添える */
const quantityHint = computed(() => {
  const filled = order.value?.filledQuantity ?? 0
  return filled > 0 ? `出来数量 ${formatQuantity(filled)}株を含む総数量` : ''
})

/*
 * 市場区分の選択肢。知らないコードの注文を開いたときは、そのコードも選択肢に足す
 * （足さないと select が空表示になり、何も変えていないのに区分が消えたように見える）。
 */
const marketScopeOptions = computed(() => {
  const current = order.value?.marketScope
  if (!current || MARKET_SCOPE_OPTIONS.some((option) => option.value === current)) {
    return MARKET_SCOPE_OPTIONS
  }
  return [...MARKET_SCOPE_OPTIONS, { value: current, label: current }]
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

  // 桁区切りのカンマは入力の癖として許す（画面モックは入力中にカンマを付ける）
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
    <p class="order-amend__description" data-testid="order-amend-description">
      注文ID #{{ route.params.orderId }} の内容を確認し、変更が必要な項目だけを訂正します。
    </p>

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
      <BaseAlert variant="info" data-testid="order-amend-notice">
        訂正できるのは未発注・注文中・一部出来の注文です。発注済みの注文は、原注文を取り消したうえで
        訂正注文として受け付けます（原注文の取消が完了すると発注されます）。
      </BaseAlert>

      <BaseCard title="訂正対象注文">
        <template #header-actions>
          <BaseBadge variant="info" data-testid="order-amend-status">
            {{ statusLabel }}
          </BaseBadge>
        </template>

        <OrderDetailSummary :items="summaryItems" data-testid="order-amend-summary" />
      </BaseCard>

      <BaseCard title="訂正内容">
        <template #header-actions>
          <span class="order-amend__note">基本情報・売買区分は変更できません</span>
        </template>

        <BaseAlert v-if="locked" variant="warning" data-testid="order-amend-locked">
          この注文は訂正できません（処理状況: {{ statusLabel }}）。
        </BaseAlert>

        <form v-else class="order-amend__form" data-testid="order-amend-form" @submit.prevent="submit">
          <BaseAlert v-if="amendError" variant="error" data-testid="order-amend-submit-error">
            {{ amendError.message }}
          </BaseAlert>
          <BaseAlert v-if="errors.form" variant="error" data-testid="order-amend-form-error">
            {{ errors.form }}
          </BaseAlert>

          <FormGrid :columns="2">
            <FormField
              v-slot="{ field }"
              label="注文数量（株）"
              required
              :hint="quantityHint"
              :error="errors.quantity"
            >
              <BaseInput
                v-bind="field"
                v-model="quantityInput"
                inputmode="numeric"
                data-testid="order-amend-quantity"
              />
            </FormField>

            <FormField v-slot="{ field }" label="市場区分" required>
              <BaseSelect
                v-bind="field"
                v-model="marketScopeInput"
                :options="marketScopeOptions"
                data-testid="order-amend-market-scope"
              />
            </FormField>

            <!-- ボタンの並びなので label 要素と結び付けられない。名前は aria-label で持たせる -->
            <FormField label="価格" required>
              <BaseSegmentedControl
                v-model="orderTypeInput"
                :options="ORDER_TYPE_OPTIONS"
                aria-label="価格"
                data-testid="order-amend-order-type"
              />
            </FormField>

            <FormField
              v-if="isLimit"
              v-slot="{ field }"
              label="指値価格（USD）"
              required
              :error="errors.limitPrice"
            >
              <BaseInput
                v-bind="field"
                v-model="limitPriceInput"
                inputmode="decimal"
                data-testid="order-amend-limit-price"
              />
            </FormField>
          </FormGrid>

          <!-- maxlength は実 API（AmendOrderRequest の 理由）の 200 文字に合わせる -->
          <FormField v-slot="{ field }" label="訂正理由（任意）" hint="注文の履歴に記録されます">
            <BaseInput
              v-bind="field"
              v-model="reasonInput"
              maxlength="200"
              placeholder="例：お客様から価格変更の申出"
              data-testid="order-amend-reason"
            />
          </FormField>

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
.order-amend {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 説明文はヘッダの見出しに続く小さな添え書き（モックの副題に相当） */
.order-amend__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.order-amend__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
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

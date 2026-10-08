<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import OrderCustomerBar from '@/components/orders/OrderCustomerBar.vue'
import OrderEntryForm from '@/components/orders/OrderEntryForm.vue'
import OrderReadback from '@/components/orders/OrderReadback.vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useOrderEntryStore } from '@/stores/orderEntry'
import { OPERATOR_CODE } from '@/utils/operator'
import {
  buildEstimateReadback,
  buildExpiryOptions,
  buildOrderInput,
  buildOrderReadback,
  createOrderForm,
  defaultOrderPerson,
  hasOrderFormErrors,
  validateOrderForm,
} from '@/utils/orderEntryForm'
import { parseOrderEntryQuery } from '@/utils/orderEntryQuery'

/*
 * 新規注文（外株注文入力）。モックリポジトリの order_input → order_confirm → order_complete を
 * 1 つのルートの 3 段階（step）で出す。段階と入力値はこの画面が持ち、API とのやり取りは
 * stores/orderEntry.js、検証と表示の組み立ては utils/orderEntryForm.js に置く。
 *
 * 止め方は 3 種類（モックと同じ）。
 *   入力の不備   … 画面で弾く。項目の直下（FormField の error）
 *   サーバの errors … 「入力エラー」の帯。確認へ進まない
 *   サーバの warnings … 「フロコン警告」の帯。強制区分を付けて送り直せば確認へ進む
 * 通信・サーバ障害は別の帯に 1 行で出す（入力はそのまま残す）。
 *
 * 顧客詳細（タブの「注文入力」・「新規注文」・預りの「買い」「売り」）からは、部店・口座番号・銘柄・
 * 売買・預り区分が URL クエリで引き継がれて入る（utils/orderEntryQuery.js）。引き継いだ値は入力欄の
 * 初期値にするだけで、顧客と銘柄は口座番号・ティッカーを打ったときと同じ照会で引き当てる。
 * 顧客詳細からの導線（タブの「注文入力」・「新規注文」・預りの「買い」「売り」）は、この画面を顧客詳細の
 * 子ルート（/customers/:customerId/order-entry）として描く。大きな顧客カードとタブ（モックの customer_context）は親の CustomerDetailView が持つ。
 * そのときはフォームの上の顧客バーを出さない（モックも customer_context では出さない。氏名・預り金が二重になる）。
 */

/** 照会を始めるまでの待ち（モックと同じ 400ms。打っている途中の値で API を叩かない） */
const LOOKUP_DELAY_MS = 400

/** 200 の不合格なのに理由が付いていないとき（実 API の返し方が未確定のための保険） */
const UNKNOWN_REJECTION = '注文内容を確認できませんでした。入力内容を見直してください。'

const PERMISSION_MESSAGE =
  'このロールには発注権限がありません。権限マスタの設定を確認してください。'

const SUSPENDED_MESSAGE = '現在、システム障害対応のため、新規の注文入力を停止しています。'

const route = useRoute()
const router = useRouter()

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useOrderEntryStore()
const {
  context,
  contextError,
  contextLoading,
  customerLookup,
  customerError,
  customerLoading,
  symbolLookup,
  symbolError,
  symbolLoading,
  validating,
  validateError,
  submitting,
  submitError,
  fxRate,
  fxLoading,
} = storeToRefs(store)

const operatorStore = useCurrentOperatorStore()
const {
  operator,
  loading: operatorLoading,
  error: operatorError,
} = storeToRefs(operatorStore)

/*
 * 期間指定と受注日の起点。画面を開いた日で固定する（開いたまま日付をまたいだら開き直してもらう。
 * 選択肢が途中で入れ替わると、選んだ期限が黙って変わる）。
 */
const today = new Date()

/** 受注者の既定値と作成者。ログイン中の社員コード（読めなければ .env の VITE_USER_CODE） */
const operatorCode = computed(() => operator.value?.operatorCode || OPERATOR_CODE)

/* ---------- 送信を受け付けない状態 ---------- */

// 読み終える前は「権限なし」と言わない（一瞬だけ帯が出るのを避ける）
const noOrderPermission = computed(
  () =>
    !operatorLoading.value &&
    (operator.value !== null || operatorError.value !== null) &&
    !operatorStore.can('order'),
)

const ordersSuspended = computed(() => Boolean(context.value?.ordersSuspended))

const blocked = computed(() => noOrderPermission.value || ordersSuspended.value)

/* ---------- 段階と入力値 ---------- */

/** 'input' | 'confirm' | 'complete' */
const step = ref('input')

const expiryOptions = computed(() =>
  context.value ? buildExpiryOptions({ today, closedDates: context.value.closedDates }) : [],
)

// 4 状態の「空」。休日の設定が先読みの範囲を埋め尽くして、期限に選べる日が 1 日も無い
const isEmpty = computed(
  () => !contextLoading.value && !contextError.value && context.value && !expiryOptions.value.length,
)

/** 新しいフォーム。期間指定は先頭（当日中）を入れておく */
function newForm(customer = {}) {
  return {
    ...createOrderForm({ orderPerson: defaultOrderPerson(operatorCode.value), ...customer }),
    expiryDate: expiryOptions.value[0]?.value ?? '',
  }
}

// 顧客詳細から入ったときは、URL クエリで引き継いだ顧客・銘柄・売買・預り区分・数量を初期値にする
const form = ref(newForm(parseOrderEntryQuery(route.query)))

// 休日を読み終えたら期間指定の先頭を入れる（開いた直後は選択肢がまだ無い）
watch(expiryOptions, (options) => {
  if (options.length && !options.some((option) => option.value === form.value.expiryDate)) {
    form.value.expiryDate = options[0].value
  }
})

/** 項目ごとの入力の不備 */
const fieldErrors = ref({})
/** 事前検証の errors / warnings（入力画面の帯） */
const serverErrors = ref([])
const serverWarnings = ref([])

/**
 * 確認へ進んだ時点の注文。確認・完了の表示と、確定で送る本文はここから取る
 * （確認画面の裏で入力値が変わっても、確かめた内容と違うものを送らない）。
 */
const pending = ref(null)
const finalChecked = ref(false)
/** 確定が 200 の success:false で返ったときの理由 */
const rejection = ref(null)
/** 登録の結果（完了画面） */
const result = ref(null)
/** 照会を待っている間も送信ボタンを押させない（事前検証の前に照会を済ませる） */
const preparing = ref(false)

/* ---------- 顧客・銘柄の照会 ---------- */

const customerKey = computed(() => ({
  branchCode: form.value.branchCode.trim(),
  accountNumber: form.value.accountNumber.trim(),
}))
const tickerKey = computed(() => form.value.ticker.trim().toUpperCase())

// 照会の結果は、いまの入力に対するものだけを使う（打ち直した直後の古い結果を出さない）
const currentCustomerLookup = computed(() => {
  const lookup = customerLookup.value
  const { branchCode, accountNumber } = customerKey.value
  return lookup && lookup.accountNumber === accountNumber && lookup.branchCode === branchCode
    ? lookup
    : null
})
const currentSymbolLookup = computed(() =>
  symbolLookup.value && symbolLookup.value.ticker === tickerKey.value ? symbolLookup.value : null,
)

const customer = computed(() => currentCustomerLookup.value?.customer ?? null)
const symbol = computed(() => currentSymbolLookup.value?.symbol ?? null)

/** 顧客詳細の子ルートとして描いている（顧客カードは親が出す） */
const inCustomerDetail = computed(() => route.name === 'customer-order-entry')

/*
 * 照会結果のヒント。照会の失敗は何も出さない（モックと同じ。入力は続けられ、送信時に理由が出る）。
 */
function lookupHint({ hasInput, loading, failed, lookup, foundText, notFoundText }) {
  if (!hasInput || failed) return { text: '', tone: '' }
  if (lookup) {
    return foundText ? { text: foundText, tone: 'found' } : { text: notFoundText, tone: 'not-found' }
  }
  return loading ? { text: '照会中…', tone: 'muted' } : { text: '', tone: '' }
}

const customerHint = computed(() =>
  lookupHint({
    hasInput: Boolean(customerKey.value.accountNumber),
    loading: customerLoading.value,
    failed: Boolean(customerError.value),
    lookup: currentCustomerLookup.value,
    foundText: customer.value?.customerName,
    notFoundText: '該当なし',
  }),
)

// 銘柄名の前に、引き当てた銘柄のティッカーと銘柄コードを並べる（どちらで入力しても両方が判る。モックと同じ）
const symbolHint = computed(() => {
  const hint = lookupHint({
    hasInput: Boolean(tickerKey.value),
    loading: symbolLoading.value,
    failed: Boolean(symbolError.value),
    lookup: currentSymbolLookup.value,
    foundText: symbol.value?.nameEn || symbol.value?.name,
    notFoundText: '銘柄なし',
  })
  if (hint.tone !== 'found') return hint
  const { ticker, symbolCode } = symbol.value
  return { ...hint, code: `ティッカー：${ticker || '—'} ／ 銘柄コード：${symbolCode || '—'}` }
})

let customerTimer = null
let symbolTimer = null

watch(customerKey, ({ branchCode, accountNumber }, previous) => {
  if (previous && branchCode === previous.branchCode && accountNumber === previous.accountNumber) {
    return
  }
  clearTimeout(customerTimer)
  if (!accountNumber) {
    store.clearCustomer()
    return
  }
  customerTimer = setTimeout(
    () => store.lookupCustomer({ branchCode, accountNumber }),
    LOOKUP_DELAY_MS,
  )
})

watch(tickerKey, (ticker) => {
  clearTimeout(symbolTimer)
  if (!ticker) {
    store.clearSymbol()
    return
  }
  symbolTimer = setTimeout(() => store.lookupSymbol(ticker), LOOKUP_DELAY_MS)
})

onBeforeUnmount(() => {
  clearTimeout(customerTimer)
  clearTimeout(symbolTimer)
})

/**
 * 送信の前に、いまの入力に対する照会を済ませる（打ってすぐ送信すると、待ちの 400ms が明けていない）。
 * 失敗していたら引き直す（一時的な失敗のまま「見つからない」扱いにしない）。
 */
async function settleLookups() {
  const tasks = []
  const { branchCode, accountNumber } = customerKey.value
  if (accountNumber && !currentCustomerLookup.value) {
    clearTimeout(customerTimer)
    tasks.push(store.lookupCustomer({ branchCode, accountNumber }))
  }
  if (tickerKey.value && !currentSymbolLookup.value) {
    clearTimeout(symbolTimer)
    tasks.push(store.lookupSymbol(tickerKey.value))
  }
  await Promise.all(tasks)
}

/* ---------- 入力 → 確認 ---------- */

async function submitInput() {
  // 送信ボタンは :disabled で塞いであるが、入力欄での Enter でも submit は飛ぶ
  if (preparing.value || validating.value || blocked.value) return

  store.clearValidateError()
  preparing.value = true
  try {
    await settleLookups()
  } finally {
    preparing.value = false
  }

  fieldErrors.value = validateOrderForm(form.value, {
    symbol: symbol.value,
    symbolLookupFailed: !currentSymbolLookup.value && Boolean(symbolError.value),
    today,
  })
  if (hasOrderFormErrors(fieldErrors.value)) return

  const input = buildOrderInput(form.value, {
    symbol: symbol.value,
    today,
    createdBy: operatorCode.value || form.value.orderPerson.trim(),
  })
  const validation = await store.validate(input)
  // 通信・サーバ障害。理由は validateError に出る。前回の結果の帯は残さない
  if (!validation) {
    serverErrors.value = []
    serverWarnings.value = []
    return
  }

  serverErrors.value = validation.errors
  serverWarnings.value = validation.warnings
  if (validation.errors.length > 0) return
  // 警告は、強制区分を付けて送り直したときだけ通す
  if (validation.warnings.length > 0 && !form.value.forced) return
  if (!validation.valid && validation.warnings.length === 0) {
    serverErrors.value = [UNKNOWN_REJECTION]
    return
  }

  const snapshot = { ...form.value }
  pending.value = {
    input,
    form: snapshot,
    symbol: symbol.value,
    warnings: validation.warnings,
    readback: buildOrderReadback(snapshot, {
      customer: customer.value,
      symbol: symbol.value,
      expiryOptions: expiryOptions.value,
    }),
  }
  finalChecked.value = false
  rejection.value = null
  store.clearSubmitError()
  step.value = 'confirm'
  // 概算の為替。取れなくても確定は止めない（金額が「—」になるだけ）
  store.loadFxRate()
}

/* ---------- 確認 → 完了 ---------- */

const estimate = computed(() =>
  pending.value
    ? buildEstimateReadback({
        form: pending.value.form,
        symbol: pending.value.symbol,
        fxRate: fxRate.value,
        fxLoading: fxLoading.value,
      })
    : null,
)

function backToInput() {
  if (submitting.value) return
  finalChecked.value = false
  rejection.value = null
  store.clearSubmitError()
  step.value = 'input'
}

async function confirmOrder() {
  if (submitting.value || !finalChecked.value || blocked.value) return

  rejection.value = null
  const response = await store.submit(pending.value.input)
  // 通信・サーバ障害。理由は submitError に出る。確認画面に留まって押し直させる
  if (!response) return

  if (!response.success) {
    rejection.value = {
      message: response.message || UNKNOWN_REJECTION,
      reasons: [...response.errors, ...response.warnings],
    }
    return
  }

  result.value = response
  step.value = 'complete'
}

/* ---------- 完了 → 次の注文 ---------- */

/**
 * 入力画面に戻して、同じ顧客で次の注文を始める（モックの「同顧客で新規注文」）。部店と口座番号を引き継ぐ。
 */
function startNewOrderSameCustomer() {
  const { branchCode, accountNumber } = pending.value?.form ?? {}
  form.value = newForm({ branchCode, accountNumber })
  fieldErrors.value = {}
  serverErrors.value = []
  serverWarnings.value = []
  pending.value = null
  rejection.value = null
  result.value = null
  finalChecked.value = false
  store.clearSymbol()
  store.clearValidateError()
  store.clearSubmitError()
  step.value = 'input'
}

/** 別の顧客の注文は顧客を選び直すところから（/orders/new の「顧客の指定が無ければ顧客検索へ」と同じ） */
function goToCustomerSearch() {
  router.push({ name: 'customer-search' })
}

function goToInquiry() {
  router.push('/orders/inquiry')
}

function reload() {
  store.loadContext(today)
}

// 前回この画面で引いた顧客・銘柄やエラーを持ち越さない（Pinia は画面をまたいで残る）
store.reset()
// 初回読み込み。onMounted に置くと最初の描画で一瞬フォームが出るため setup で始める
store.loadContext(today)
/*
 * 引き継いだ口座番号・ティッカーの照会。入力欄の watch は値が変わったときにしか走らないので、
 * 初期値として入った分はここで引く（打ったときと同じ照会。待ちの 400ms は置かない）
 */
if (customerKey.value.accountNumber) store.lookupCustomer(customerKey.value)
if (tickerKey.value) store.lookupSymbol(tickerKey.value)
// 起動時に main.js が読み始めているので、たいていは読み終えている。受注者が空なら埋める
// （社員コードが 5 文字以上なら空のまま。受注者は 4 文字までなので手で入れてもらう）
operatorStore.ensureLoaded().then(() => {
  if (!form.value.orderPerson) form.value.orderPerson = defaultOrderPerson(operatorCode.value)
})
</script>

<template>
  <section class="order-entry">
    <!-- ローディング / エラー / 空 / データあり の 4 状態（期間指定に使う休日と発注停止の状態） -->
    <p v-if="contextLoading" data-testid="order-entry-loading" class="order-entry__status is-loading">
      <BaseSpinner />
    </p>

    <div v-else-if="contextError" data-testid="order-entry-error" class="order-entry__status is-error">
      <p>{{ contextError.message }}</p>
      <BaseButton variant="secondary" data-testid="order-entry-retry" @click="reload">
        再試行
      </BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="order-entry-empty" class="order-entry__status">
      期間指定に選べる営業日がありません。受注不可日・海外休場日の設定を確認してください。
    </p>

    <template v-else-if="context">
      <BaseAlert v-if="noOrderPermission" variant="error" data-testid="order-entry-no-permission">
        {{ PERMISSION_MESSAGE }}
      </BaseAlert>
      <BaseAlert v-if="ordersSuspended" variant="warning" data-testid="order-entry-suspended">
        {{ SUSPENDED_MESSAGE }}
      </BaseAlert>

      <!-- 入力 -->
      <template v-if="step === 'input'">
        <BaseAlert v-if="validateError" variant="error" data-testid="order-entry-validate-error">
          {{ validateError.message }}
        </BaseAlert>

        <BaseAlert v-if="serverErrors.length" variant="error" data-testid="order-entry-errors">
          <strong>入力エラー</strong>
          <ul class="order-entry__messages">
            <li v-for="message in serverErrors" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <BaseAlert v-if="serverWarnings.length" variant="warning" data-testid="order-entry-warnings">
          <strong>フロコン警告</strong>
          <ul class="order-entry__messages">
            <li v-for="message in serverWarnings" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <OrderEntryForm
          v-model="form"
          :errors="fieldErrors"
          :expiry-options="expiryOptions"
          :customer-hint="customerHint"
          :symbol-hint="symbolHint"
          :warned="serverWarnings.length > 0"
          :disabled="blocked"
          :submitting="preparing || validating"
          @submit="submitInput"
        >
          <template #customer>
            <OrderCustomerBar v-if="customer && !inCustomerDetail" :customer="customer" />
          </template>
        </OrderEntryForm>
      </template>

      <!-- 確認 -->
      <div v-else-if="step === 'confirm'" class="order-entry__review" data-testid="order-entry-confirm">
        <BaseAlert
          v-if="pending.warnings.length"
          variant="warning"
          data-testid="order-entry-confirmed-warnings"
        >
          <strong>フロコン警告（確認済）</strong>
          <ul class="order-entry__messages">
            <li v-for="message in pending.warnings" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <BaseAlert v-if="submitError" variant="error" data-testid="order-entry-submit-error">
          {{ submitError.message }}
        </BaseAlert>

        <BaseAlert v-if="rejection" variant="error" data-testid="order-entry-rejected">
          <strong>{{ rejection.message }}</strong>
          <ul v-if="rejection.reasons.length" class="order-entry__messages">
            <li v-for="message in rejection.reasons" :key="message">{{ message }}</li>
          </ul>
        </BaseAlert>

        <p class="order-entry__lead">
          <span class="order-entry__step" aria-hidden="true">2</span>
          顧客・銘柄・売買・価格・数量を上から順に確認して、注文を確定してください。
        </p>

        <BaseCard title="注文内容確認">
          <template #header-actions>
            <span :class="['order-entry__trade', `is-${pending.readback.tone}`]">
              {{ pending.readback.tradeLabel }}
            </span>
          </template>

          <OrderReadback :readback="pending.readback" :estimate="estimate" />

          <BaseCheckbox
            v-model="finalChecked"
            label="顧客口座・銘柄・売買・価格・数量・有効期限を確認しました。"
            class="order-entry__final-check"
            data-testid="order-entry-final-check"
          />

          <div class="order-entry__actions">
            <BaseButton
              variant="secondary"
              data-testid="order-entry-back"
              :disabled="submitting"
              @click="backToInput"
            >
              入力へ戻る
            </BaseButton>
            <BaseButton
              class="order-entry__confirm"
              data-testid="order-entry-confirm-submit"
              :disabled="!finalChecked || submitting || blocked"
              :loading="submitting"
              @click="confirmOrder"
            >
              {{ submitting ? '確定中…' : '注文を確定' }}
            </BaseButton>
          </div>
        </BaseCard>
      </div>

      <!-- 完了 -->
      <div v-else class="order-entry__review" data-testid="order-entry-complete">
        <div :class="['order-entry__result', `is-${pending.readback.tone}`]">
          <strong>注文を受け付けました</strong>
          <!-- 受付の文言はサーバが返す。自前で組み立てない -->
          <span data-testid="order-entry-complete-message">
            {{ result.message }} ／ 以後の状況は注文照会でご確認ください。
          </span>
        </div>

        <BaseCard title="注文受付内容">
          <template #header-actions>
            <span class="order-entry__header-actions">
              <span :class="['order-entry__trade', `is-${pending.readback.tone}`]">
                {{ pending.readback.tradeLabel }}
              </span>
              <span class="order-entry__order-id" data-testid="order-entry-order-id">
                注文ID #{{ result.orderId }}
              </span>
            </span>
          </template>

          <OrderReadback :readback="pending.readback" :estimate="estimate" />

          <div class="order-entry__actions">
            <BaseButton
              variant="secondary"
              data-testid="order-entry-new-same-customer"
              @click="startNewOrderSameCustomer"
            >
              同じ顧客で新規注文
            </BaseButton>
            <BaseButton
              variant="secondary"
              data-testid="order-entry-new-order"
              @click="goToCustomerSearch"
            >
              別の顧客で新規注文
            </BaseButton>
            <BaseButton data-testid="order-entry-to-inquiry" @click="goToInquiry">
              注文照会へ
            </BaseButton>
          </div>
        </BaseCard>
      </div>
    </template>
  </section>
</template>

<style scoped>
.order-entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* モックの .fsk-form / .order-review-wrap と同じ。横に間延びさせない */
  max-width: 1040px;
}

.order-entry__messages {
  margin: var(--space-1) 0 0 var(--space-4);
  padding: 0;
}

.order-entry__review {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.order-entry__lead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-label);
  font-size: var(--font-size-sm);
}

/* 確認の段階を示す丸数字（モックの .order-review-step） */
.order-entry__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background-color: var(--color-primary);
  color: var(--color-primary-contrast);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

/* カード見出しの横の「買注文」「売注文」の帯 */
.order-entry__trade {
  margin-right: auto;
  padding: 2px var(--space-3);
  border-radius: 3px;
  background-color: var(--color-sell);
  color: var(--color-primary-contrast);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.order-entry__trade.is-buy {
  background-color: var(--color-buy);
}

.order-entry__header-actions {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
}

.order-entry__order-id {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.order-entry__final-check {
  display: flex;
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
}

.order-entry__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.order-entry__confirm {
  min-width: 210px;
}

/* 完了の状態帯。左端の線が売買の色（モックの .result-status） */
.order-entry__result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-left: 4px solid var(--color-sell);
  background-color: var(--color-sell-bg);
  color: var(--color-text);
}

.order-entry__result.is-buy {
  border-left-color: var(--color-buy);
  background-color: var(--color-buy-bg);
}

.order-entry__result strong {
  font-size: var(--font-size-md);
}

.order-entry__result span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.order-entry__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.order-entry__status.is-loading {
  display: flex;
  justify-content: center;
}

.order-entry__status.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>

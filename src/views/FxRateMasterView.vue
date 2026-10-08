<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import FormField from '@/components/ui/FormField.vue'
import MasterFormDialog from '@/components/masters/MasterFormDialog.vue'
import { useFxRatesStore } from '@/stores/fxRates'
import { formatDateTime } from '@/utils/format'

/*
 * 為替マスタ（USD/JPY の現在レート）。画面モックは「公示（社内）レート」と「源泉レート」の
 * カード 2 枚と、両方を同時に更新する「レート更新」モーダル。2 つのレートは同じ行の 2 項目。
 *
 * 一覧・検索・削除が無い単一レコードの画面なので、マスタ一覧の型（useListQuery / useCrudList /
 * MasterSearchCard / MasterListCard）には乗せない。入力モーダルの枠だけ MasterFormDialog を使う。
 *
 * モックとの違い（2026-09-29 決定）:
 *   - 「適用日」を置かない。更新の対象は当日の行だけで、基準日は store が今日（JST）で決める
 *   - 「備考」を置かない。FxRequest に項目が無い
 *   - 「取込日時」の代わりに最終更新（更新日時・更新者）を出す。取込日時にあたる項目が API に無い。
 *     2 つのレートは同じ行なので、両カードの基準日・最終更新は同じ値になる
 *   - 「閲覧のみ」の出し分けを置かない。ルートが requiredPermission: 'master' なので、開けた人は更新できる
 */

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useFxRatesStore()
const {
  rate,
  loading,
  error,
  isEmpty,
  saving,
  saveError,
  validationErrors,
  validationWarnings,
} = storeToRefs(store)

const noticeMessage = ref('')

/*
 * レート更新。ヘッダの「レート更新」からモーダルを開く。
 *
 * 出し先は 4 つに分かれる（MasterFormDialog の約束どおり）。
 *   入力の不備      … FormField の error（未入力だけを画面で見る）
 *   事前検証の不合格 … store.validationErrors
 *   事前検証の警告   … store.validationWarnings（一般的な範囲 50〜300 円から外れる公示レート）
 *   通信・サーバ障害 … store.saveError（正の数でない値の 422、楽観的ロックの 409 もここ）
 * 値の範囲の判定はサーバに任せる。画面側にも同じ規則を書くと二重管理になって食い違う。
 *
 * 源泉レートは API では任意だが、画面モックどおり必須にする。変更（PUT）は部分更新ではなく、
 * 空のまま送ると登録済みの源泉レートを消してしまうため。
 */
const isUpdateOpen = ref(false)
const rateInput = ref('')
const withholdingRateInput = ref('')
const rateInputError = ref('')
const withholdingRateInputError = ref('')

const hasWarnings = computed(() => validationWarnings.value.length > 0)
const submitLabel = computed(() => (hasWarnings.value ? '続行' : '更新'))

// 値を変えたら前回の検証結果は当てにならない。承知済みの警告も持ち越さない
watch([rateInput, withholdingRateInput], () => store.clearSaveError())

function openUpdate() {
  noticeMessage.value = ''
  rateInputError.value = ''
  withholdingRateInputError.value = ''
  // 初期値は現在レート（画面モックと同じ）。未登録・未設定なら空欄から入れてもらう
  rateInput.value = toInputValue(rate.value?.rate)
  withholdingRateInput.value = toInputValue(rate.value?.withholdingRate)
  store.clearSaveError()
  isUpdateOpen.value = true
}

function closeUpdate() {
  isUpdateOpen.value = false
  store.clearSaveError()
}

async function submitUpdate() {
  // 送信ボタンは :pending で塞いであるが、入力欄での Enter でも submit は飛ぶ。二重送信はここで止める
  if (saving.value) return

  rateInputError.value = requiredError(rateInput.value)
  withholdingRateInputError.value = requiredError(withholdingRateInput.value)
  if (rateInputError.value || withholdingRateInputError.value) return

  const saved = await store.save({
    rate: Number(rateInput.value),
    withholdingRate: Number(withholdingRateInput.value),
    // 警告を出したうえでもう一度押されたので、承知したものとして保存に進む
    acknowledgedWarnings: hasWarnings.value,
  })
  // 失敗時と確認待ちのときはモーダルを開いたままにして理由を読ませる
  if (!saved) return

  isUpdateOpen.value = false
  noticeMessage.value =
    `USD/JPY の公示（社内）レートを ${formatRate(saved.rate)} 円、` +
    `源泉レートを ${formatRate(saved.withholdingRate)} 円に更新しました。`
}

function reload() {
  noticeMessage.value = ''
  store.load()
}

// type="number" の v-model は数値を返すことがある（空欄だけ ''）ので文字列に寄せてから見る
function requiredError(value) {
  return String(value).trim() ? '' : 'レートを入力してください。'
}

function toInputValue(value) {
  return typeof value === 'number' ? String(value) : ''
}

// 画面モックと同じ小数 4 桁。源泉レートの未設定（null）は「—」
function formatRate(value) {
  return typeof value === 'number' ? value.toFixed(4) : '—'
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「未登録」が出るため setup で始める
store.load()
</script>

<template>
  <section class="fx-rates">
    <Teleport defer to="#topbar-actions">
      <!-- 読めていないあいだは、今日の行を変更するのか登録するのかが決まらないので押させない -->
      <BaseButton data-testid="fx-update" :disabled="loading || !!error" @click="openUpdate">
        レート更新
      </BaseButton>
    </Teleport>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="fx-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p v-if="loading" data-testid="fx-loading" class="fx-rates__status is-loading">
      <BaseSpinner />
    </p>

    <div v-else-if="error" data-testid="fx-error" class="fx-rates__status is-error">
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="reload">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="fx-empty" class="fx-rates__status">
      USD/JPY の為替レートが登録されていません。「レート更新」から今日のレートを登録してください。
    </p>

    <div v-else class="fx-rates__cards" data-testid="fx-current">
      <section class="fx-rates__card is-public" data-testid="fx-public-card">
        <div>
          <div class="fx-rates__label">公示（社内）レート</div>
          <div class="fx-rates__value" data-testid="fx-rate">{{ formatRate(rate.rate) }}</div>
          <div class="fx-rates__meta">
            <span>基準日：<span data-testid="fx-base-date">{{ rate.baseDate }}</span></span>
            <span>
              最終更新：<span data-testid="fx-updated">
                {{ formatDateTime(rate.updatedAt || rate.createdAt) }}
                <template v-if="rate.updatedBy">（{{ rate.updatedBy }}）</template>
              </span>
            </span>
          </div>
        </div>
        <div class="fx-rates__badge">
          <div class="fx-rates__badge-label">通貨ペア</div>
          <div class="fx-rates__badge-value">USD/JPY</div>
        </div>
      </section>

      <section class="fx-rates__card is-withholding" data-testid="fx-withholding-card">
        <div>
          <div class="fx-rates__label">源泉レート</div>
          <div class="fx-rates__value" data-testid="fx-withholding-rate">
            {{ formatRate(rate.withholdingRate) }}
          </div>
          <div class="fx-rates__meta">
            <span>基準日：<span data-testid="fx-withholding-base-date">{{ rate.baseDate }}</span></span>
            <span>
              最終更新：<span data-testid="fx-withholding-updated">
                {{ formatDateTime(rate.updatedAt || rate.createdAt) }}
                <template v-if="rate.updatedBy">（{{ rate.updatedBy }}）</template>
              </span>
            </span>
          </div>
        </div>
        <div class="fx-rates__badge">
          <div class="fx-rates__badge-label">通貨ペア</div>
          <div class="fx-rates__badge-value">USD/JPY</div>
        </div>
      </section>
    </div>

    <MasterFormDialog
      :open="isUpdateOpen"
      title="USD/JPY レート更新"
      testid-prefix="fx"
      action="update"
      :submit-label="submitLabel"
      :pending="saving"
      :error="saveError"
      :validation-errors="validationErrors"
      :validation-warnings="validationWarnings"
      @close="closeUpdate"
      @submit="submitUpdate"
    >
      <p class="fx-rates__hint">
        公示（社内）レートと源泉レートを同時に更新します。今日の日付のレートとして保存します。
      </p>
      <div class="fx-rates__update-grid">
        <section class="fx-rates__update-section">
          <div class="fx-rates__update-title">公示（社内）レート</div>
          <FormField v-slot="{ field }" label="レート（円）" required :error="rateInputError">
            <BaseInput
              v-bind="field"
              v-model="rateInput"
              type="number"
              step="0.0001"
              inputmode="decimal"
              placeholder="例: 150.2500"
              data-testid="fx-rate-input"
            />
          </FormField>
        </section>
        <section class="fx-rates__update-section">
          <div class="fx-rates__update-title">源泉レート</div>
          <FormField
            v-slot="{ field }"
            label="レート（円）"
            required
            :error="withholdingRateInputError"
          >
            <BaseInput
              v-bind="field"
              v-model="withholdingRateInput"
              type="number"
              step="0.0001"
              inputmode="decimal"
              placeholder="例: 149.8000"
              data-testid="fx-withholding-rate-input"
            />
          </FormField>
        </section>
      </div>
    </MasterFormDialog>
  </section>
</template>

<style scoped>
.fx-rates {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 画面モックの 2 列（最大 920px）。狭い画面では 1 列に落とす */
.fx-rates__cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  max-width: 920px;
}

/* レートのカード。画面モックの濃紺の面＋白文字 */
.fx-rates__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-6);
  color: var(--color-primary-contrast);
  background-color: var(--color-primary);
  border-radius: var(--radius-md);
}

/* 源泉レートは画面モックどおり一段明るい紺にして、公示レートと見分ける */
.fx-rates__card.is-withholding {
  background-color: var(--color-primary-hover);
}

.fx-rates__label {
  margin-bottom: var(--space-1);
  font-size: var(--font-size-md);
  opacity: 0.75;
}

/* モックの 38px。トークンを増やさず 2xl（24px）の倍率で出す */
.fx-rates__value {
  font-size: calc(var(--font-size-2xl) * 1.6);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.fx-rates__meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
  opacity: 0.75;
}

.fx-rates__badge {
  padding: var(--space-3) var(--space-4);
  text-align: right;
  border: 1px solid var(--color-sidebar-border);
  border-radius: var(--radius-md);
}

.fx-rates__badge-label {
  margin-bottom: var(--space-1);
  font-size: var(--font-size-xs);
  opacity: 0.7;
}

.fx-rates__badge-value {
  font-family: var(--font-family-numeric);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.fx-rates__hint {
  margin: 0 0 var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* モーダルの 2 区画（公示 / 源泉）。画面モックの fx-update-grid */
.fx-rates__update-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.fx-rates__update-section {
  padding: var(--space-3) var(--space-4);
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.fx-rates__update-title {
  margin-bottom: var(--space-3);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

@media (max-width: 720px) {
  .fx-rates__cards,
  .fx-rates__update-grid {
    grid-template-columns: 1fr;
  }
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.fx-rates__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* スピナーだけを置くので中央に寄せる */
.fx-rates__status.is-loading {
  display: flex;
  justify-content: center;
}

.fx-rates__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>

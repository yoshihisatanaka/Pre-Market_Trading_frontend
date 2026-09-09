<script setup>
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useHardLimitsStore } from '@/stores/hardLimits'
import { formatQuantity } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useHardLimitsStore()
const { settings, loading, error, isEmpty, saving, saveError } = storeToRefs(store)

/*
 * 市場関与率だけは、ストア（＝バックエンド）が比率で持ち、画面は % で見せる。
 * 換算をここに閉じ込め、表示・入力欄の初期値・保存時の 3 か所で同じ規則を使う。
 * 小数第 4 位までに丸めるのは API の下限が 0.0001（= 0.01%）だから。
 */
function toPercent(ratio) {
  return Math.round(ratio * 10000) / 100
}

function toRatio(percentInput) {
  return Math.round(Number(percentInput) * 100) / 10000
}

// 金額は $1,000,000.00 ではなく画面モックの「USD 1,000,000」表記に合わせるため formatUsd は使わない
function formatUsdAmount(value) {
  return `USD ${formatQuantity(value)}`
}

/*
 * 設定変更フォーム。現在値が変わるたび（初回読み込み・再読み込み・保存成功）に入力欄を洗い替える。
 * 入力途中の値を握りっぱなしにしないので、保存後に画面と入力欄がずれない。
 */
const rateInput = ref('')
const quantityInput = ref('')
const amountInput = ref('')

watch(
  settings,
  (value) => {
    if (!value) return
    rateInput.value = String(toPercent(value.participationRate))
    quantityInput.value = String(value.maxQuantity)
    amountInput.value = String(value.maxAmount)
  },
  { immediate: true },
)

const noticeMessage = ref('')

/*
 * 入力値の検証はサーバ（未実装のあいだは MSW ハンドラ）に任せ、拒否の理由をそのまま出す。
 * 画面側にも同じ規則を書くと、二重管理になって食い違う。
 */
async function submitSave() {
  // 保存ボタンは :disabled で塞いであるが、入力欄での Enter でも submit は飛ぶ。
  // 二重送信（PUT が並列に出る）はここで止める
  if (saving.value) return

  noticeMessage.value = ''
  store.clearSaveError()

  const updated = await store.save({
    participationRate: toRatio(rateInput.value),
    maxQuantity: Number(quantityInput.value),
    maxAmount: Number(amountInput.value),
  })
  // 失敗時は入力をそのまま残して直させる（理由は saveError に出る）
  if (!updated) return

  noticeMessage.value = 'ハードリミットを保存しました。'
}

function reload() {
  noticeMessage.value = ''
  store.clearSaveError()
  store.load()
}

// 初回読み込み。onMounted に置くと最初の描画で一瞬「未設定」が出るため setup で始める
store.load()
</script>

<template>
  <section class="hard-limit">
    <!-- 見出しはヘッダが meta.title から出す。画面固有の操作だけをヘッダへ差し込む -->
    <Teleport defer to="#topbar-actions">
      <BaseButton
        variant="secondary"
        data-testid="hard-limits-reload"
        :disabled="loading"
        @click="reload"
      >
        再読み込み
      </BaseButton>
    </Teleport>

    <BaseAlert variant="info" data-testid="hard-limits-mock-notice">
      モック表示です。直近5営業日の平均出来高の取込値を分母に、市場関与率・注文数量・注文金額（USD）のうち最も厳しい株数上限で注文を自動分割するイメージです。実IB連携・実TWS投入は行いません。
    </BaseAlert>

    <BaseAlert v-if="noticeMessage" variant="success" data-testid="hard-limits-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p v-if="loading" data-testid="hard-limits-loading" class="hard-limit__status">読み込み中…</p>

    <div v-else-if="error" data-testid="hard-limits-error" class="hard-limit__status is-error">
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="reload">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="hard-limits-empty" class="hard-limit__status">
      ハードリミットが設定されていません。
    </p>

    <template v-else>
      <BaseCard title="現在のハードリミット">
        <template #header-actions>
          <span class="hard-limit__caption">5営業日平均出来高基準</span>
        </template>

        <dl class="hard-limit__list" data-testid="hard-limits-current">
          <div class="hard-limit__item">
            <dt class="hard-limit__term">市場関与率 上限</dt>
            <dd class="hard-limit__detail">
              <span class="hard-limit__value" data-testid="hard-limits-rate">
                {{ toPercent(settings.participationRate).toFixed(2) }}%
              </span>
              <span class="hard-limit__note">5営業日平均出来高 × 上限率</span>
            </dd>
          </div>

          <div class="hard-limit__item">
            <dt class="hard-limit__term">1注文あたり数量 上限</dt>
            <dd class="hard-limit__detail">
              <span class="hard-limit__value" data-testid="hard-limits-quantity">
                {{ formatQuantity(settings.maxQuantity) }} 株
              </span>
              <span class="hard-limit__note">注文数量で判定</span>
            </dd>
          </div>

          <div class="hard-limit__item">
            <dt class="hard-limit__term">1注文あたり金額 上限</dt>
            <dd class="hard-limit__detail">
              <span class="hard-limit__value" data-testid="hard-limits-amount">
                {{ formatUsdAmount(settings.maxAmount) }}
              </span>
              <span class="hard-limit__note">価格 × 数量で判定</span>
            </dd>
          </div>
        </dl>
      </BaseCard>

      <BaseCard title="設定変更">
        <template #header-actions>
          <span class="hard-limit__caption">管理責任者</span>
        </template>

        <form class="hard-limit__form" data-testid="hard-limits-form" @submit.prevent="submitSave">
          <BaseAlert v-if="saveError" variant="error" data-testid="hard-limits-save-error">
            {{ saveError.message }}
          </BaseAlert>

          <FormGrid :columns="3">
            <FormField v-slot="{ field }" label="市場関与率（%）">
              <BaseInput
                v-bind="field"
                v-model="rateInput"
                type="number"
                step="0.01"
                inputmode="decimal"
                data-testid="hard-limits-rate-input"
              />
            </FormField>

            <FormField v-slot="{ field }" label="注文数量 上限（株）">
              <BaseInput
                v-bind="field"
                v-model="quantityInput"
                type="number"
                step="1"
                inputmode="numeric"
                data-testid="hard-limits-quantity-input"
              />
            </FormField>

            <FormField v-slot="{ field }" label="注文金額 上限（USD）">
              <BaseInput
                v-bind="field"
                v-model="amountInput"
                type="number"
                step="any"
                inputmode="decimal"
                data-testid="hard-limits-amount-input"
              />
            </FormField>
          </FormGrid>

          <div class="hard-limit__actions">
            <BaseButton type="submit" data-testid="hard-limits-save" :disabled="saving">
              {{ saving ? '保存中…' : '保存' }}
            </BaseButton>
          </div>
        </form>
      </BaseCard>
    </template>
  </section>
</template>

<style scoped>
.hard-limit {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* カードヘッダ右の補足（「5営業日平均出来高基準」「管理責任者」） */
.hard-limit__caption {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.hard-limit__list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}

@media (max-width: 900px) {
  .hard-limit__list {
    grid-template-columns: 1fr;
  }
}

.hard-limit__item {
  padding: var(--space-4);
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.hard-limit__term {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.hard-limit__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
}

/* 3 つ並ぶので桁位置を揃える */
.hard-limit__value {
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.hard-limit__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.hard-limit__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.hard-limit__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.hard-limit__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.hard-limit__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>

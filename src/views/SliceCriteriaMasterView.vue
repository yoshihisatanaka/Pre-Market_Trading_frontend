<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import FormField from '@/components/ui/FormField.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import { useSliceCriteriaStore } from '@/stores/sliceCriteria'
import { formatQuantity } from '@/utils/format'

// view は api/ を直接呼ばない。必ずストア（または composable）を経由する。
const store = useSliceCriteriaStore()
const { settings, loading, error, isEmpty, saving, saveError } = storeToRefs(store)

/*
 * 更新できるのは管理責任者だけ、という出し分け。ログインユーザとロールの仕組みは
 * このフロントにまだ無いので、画面モックが ?as_user で切り替えているのに倣い、
 * 見た目を確かめられる逃げ道として ?as_user=viewer のときだけ閲覧のみにする。
 * 既定（クエリなし）は編集可。仕組みが入ったらこの 1 行を差し替える。
 */
const route = useRoute()
const canEdit = computed(() => route.query.as_user !== 'viewer')

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

  noticeMessage.value = 'スライス基準を保存しました。'
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
  <section class="slice-criteria">
    <BaseAlert v-if="noticeMessage" variant="success" data-testid="slice-criteria-notice">
      {{ noticeMessage }}
    </BaseAlert>

    <!-- ローディング / エラー / 空 / データあり の 4 状態 -->
    <p
      v-if="loading"
      data-testid="slice-criteria-loading"
      class="slice-criteria__status is-loading"
    >
      <BaseSpinner />
    </p>

    <div
      v-else-if="error"
      data-testid="slice-criteria-error"
      class="slice-criteria__status is-error"
    >
      <p>{{ error.message }}</p>
      <BaseButton variant="secondary" @click="reload">再試行</BaseButton>
    </div>

    <p v-else-if="isEmpty" data-testid="slice-criteria-empty" class="slice-criteria__status">
      スライス基準が設定されていません。
    </p>

    <template v-else>
      <BaseCard title="現在のスライス基準">
        <template #header-actions>
          <span class="slice-criteria__chip">5営業日平均出来高基準</span>
        </template>

        <dl class="slice-criteria__list" data-testid="slice-criteria-current">
          <div class="slice-criteria__item">
            <dt class="slice-criteria__term">市場関与率 上限</dt>
            <dd class="slice-criteria__detail">
              <span class="slice-criteria__value" data-testid="slice-criteria-rate">
                {{ toPercent(settings.participationRate).toFixed(2) }}%
              </span>
              <span class="slice-criteria__note">5営業日平均出来高 × 上限率</span>
            </dd>
          </div>

          <div class="slice-criteria__item">
            <dt class="slice-criteria__term">1注文あたり数量 上限</dt>
            <dd class="slice-criteria__detail">
              <span class="slice-criteria__value" data-testid="slice-criteria-quantity">
                {{ formatQuantity(settings.maxQuantity) }} 株
              </span>
              <span class="slice-criteria__note">注文数量で判定</span>
            </dd>
          </div>

          <div class="slice-criteria__item">
            <dt class="slice-criteria__term">1注文あたり金額 上限</dt>
            <dd class="slice-criteria__detail">
              <span class="slice-criteria__value" data-testid="slice-criteria-amount">
                {{ formatUsdAmount(settings.maxAmount) }}
              </span>
              <span class="slice-criteria__note">価格 × 数量で判定</span>
            </dd>
          </div>
        </dl>
      </BaseCard>

      <BaseCard title="設定変更">
        <template #header-actions>
          <span
            v-if="canEdit"
            class="slice-criteria__chip slice-criteria__chip--owner"
            data-testid="slice-criteria-role"
          >
            管理責任者
          </span>
          <span v-else class="slice-criteria__chip" data-testid="slice-criteria-role">
            閲覧のみ
          </span>
        </template>

        <p v-if="!canEdit" class="slice-criteria__readonly" data-testid="slice-criteria-readonly">
          更新は管理責任者だけが実行できます。
        </p>

        <form
          v-else
          class="slice-criteria__form"
          data-testid="slice-criteria-form"
          @submit.prevent="submitSave"
        >
          <BaseAlert v-if="saveError" variant="error" data-testid="slice-criteria-save-error">
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
                data-testid="slice-criteria-rate-input"
              />
            </FormField>

            <FormField v-slot="{ field }" label="注文数量 上限（株）">
              <BaseInput
                v-bind="field"
                v-model="quantityInput"
                type="number"
                step="1"
                inputmode="numeric"
                data-testid="slice-criteria-quantity-input"
              />
            </FormField>

            <FormField v-slot="{ field }" label="注文金額 上限（USD）">
              <BaseInput
                v-bind="field"
                v-model="amountInput"
                type="number"
                step="any"
                inputmode="decimal"
                data-testid="slice-criteria-amount-input"
              />
            </FormField>
          </FormGrid>

          <div class="slice-criteria__actions">
            <BaseButton
              type="submit"
              data-testid="slice-criteria-save"
              :disabled="saving"
              :loading="saving"
            >
              {{ saving ? '保存中…' : '保存' }}
            </BaseButton>
          </div>
        </form>
      </BaseCard>
    </template>
  </section>
</template>

<style scoped>
.slice-criteria {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* カードヘッダ右のチップ。既定はグレー面＋濃い文字 */
.slice-criteria__chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-heading);
  background-color: var(--color-surface-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
}

/* 管理責任者は淡い緑の面＋緑の枠線 */
.slice-criteria__chip--owner {
  background-color: var(--color-success-bg);
  border-color: var(--color-success-border);
}

.slice-criteria__list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}

@media (max-width: 900px) {
  .slice-criteria__list {
    grid-template-columns: 1fr;
  }
}

.slice-criteria__item {
  padding: var(--space-4);
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.slice-criteria__term {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.slice-criteria__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
}

/* 3 つ並ぶので桁位置を揃える */
.slice-criteria__value {
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.slice-criteria__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 閲覧のみのときに設定変更フォームの代わりに出す案内 */
.slice-criteria__readonly {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.slice-criteria__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.slice-criteria__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* カードの外に出る 4 状態の表示。面と枠線を自前で持つ */
.slice-criteria__status {
  padding: var(--space-5);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* スピナーだけを置くので中央に寄せる（文言が無いぶん左端に小さく出ると迷子になる） */
.slice-criteria__status.is-loading {
  display: flex;
  justify-content: center;
}

.slice-criteria__status.is-error {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-danger);
}
</style>

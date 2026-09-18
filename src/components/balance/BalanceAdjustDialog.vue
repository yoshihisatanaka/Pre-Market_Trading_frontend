<script setup>
/**
 * 残高補正の入力ダイアログ。**入力 → 確認 の 2 段階**を持つ。
 *
 * 画面モックの「既存保有への数量加算」と「新規保有を追加」は、入力項目が違うだけで
 * 枠・確認ステップ・フッタが同じなので、器だけをここで共通化する。
 *
 * masters/MasterFormDialog を使わない理由:
 *   - あちらはフッタが「キャンセル / <submitLabel>」の 1 段階固定で、モックの
 *     「戻る / 内容を確認」→「戻る / 補正を確定」にできない
 *   - 2 段階対応を足すと、あの部品を使う 4 画面 6 箇所すべてに回帰リスクが出る
 * エラーの出し先の考えかたは MasterFormDialog から踏襲する（入力の不備は呼び出し側が
 * FormField の error に、通信・サーバ障害はここで 1 行。楽観的ロックの 409 も後者）。
 *
 * **この部品は状態を持たない。** step も入力値も呼び出し側（view）が持ち、
 * ここは back / next / submit / close を emit するだけ。
 *
 * 出す data-testid（testidPrefix が 'balance-adjustments'、action が 'increase' なら
 * balance-adjustments-increase-form など）:
 *   {prefix}-{action}-form / {prefix}-{action}-error / {prefix}-{action}-confirm
 *   / {prefix}-{action}-confirm-notice / {prefix}-{action}-back
 *   / {prefix}-{action}-next / {prefix}-{action}-submit
 *
 * @see BalanceQuantityPanel 入力ステップの足元に置く集計パネル（呼び出し側が slot に差す）
 */
import { computed } from 'vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  /** 入力ステップの見出し。確認ステップでは「残高更新の確認」に差し替わる */
  title: {
    type: String,
    required: true,
  },
  testidPrefix: {
    type: String,
    required: true,
  },
  /** data-testid に挟む操作の名前。'increase'（数量を加算）/ 'add'（新規保有を追加） */
  action: {
    type: String,
    required: true,
  },
  /** いま出している段。'input'（入力）/ 'confirm'（確認） */
  step: {
    type: String,
    required: true,
    validator: (value) => ['input', 'confirm'].includes(value),
  },
  /** 確認ステップに並べる項目。`[{ label, value }]` の順どおりに出す */
  summary: {
    type: Array,
    default: () => [],
  },
  /** 登録・更新の実行中。true のあいだは戻ることもできない（結果の行き先が無くなるため） */
  pending: {
    type: Boolean,
    default: false,
  },
  /** 通信・サーバ障害の理由（ApiError） */
  error: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close', 'back', 'next', 'submit'])

const isConfirm = computed(() => props.step === 'confirm')

// 確認の見出しは操作によらず同じ（モックの「残高更新の確認」）
const dialogTitle = computed(() => (isConfirm.value ? '残高更新の確認' : props.title))

const primaryLabel = computed(() => {
  if (!isConfirm.value) return '内容を確認'
  return props.pending ? '確定中…' : '補正を確定'
})

/*
 * 入力ステップの「戻る」はモーダルを閉じる意味、確認ステップの「戻る」は入力へ帰る意味。
 * 文言が同じなのはモックどおり。押したときの行き先だけがここで分かれる。
 */
function onBack() {
  if (props.pending) return
  emit(isConfirm.value ? 'back' : 'close')
}

function onPrimary() {
  if (props.pending) return
  emit(isConfirm.value ? 'submit' : 'next')
}
</script>

<template>
  <BaseModal :open="open" :title="dialogTitle" @close="emit('close')">
    <!-- 主ボタンはモーダルのフッタ（この form の外）にあるので、
         ここでの submit は入力欄での Enter キーのためだけにある -->
    <form
      :data-testid="`${testidPrefix}-${action}-form`"
      class="balance-adjust-dialog__body"
      @submit.prevent="onPrimary"
    >
      <BaseAlert v-if="error" variant="error" :data-testid="`${testidPrefix}-${action}-error`">
        {{ error.message }}
      </BaseAlert>

      <!-- 入力ステップ。項目は画面ごとに違うので呼び出し側が差す -->
      <template v-if="!isConfirm">
        <slot />
      </template>

      <!-- 確認ステップ。入力欄は残したまま v-show で隠さず、値だけを読み上げる形にする -->
      <div v-else :data-testid="`${testidPrefix}-${action}-confirm`">
        <BaseAlert variant="warning" :data-testid="`${testidPrefix}-${action}-confirm-notice`">
          補正後の数量と更新者を確認してください。確定後の操作記録は操作ログ閲覧で確認できます。
        </BaseAlert>

        <dl class="balance-adjust-dialog__summary">
          <template v-for="row in summary" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd :class="{ 'is-numeric': row.numeric }">{{ row.value }}</dd>
          </template>
        </dl>
      </div>
    </form>

    <template #footer>
      <BaseButton
        variant="secondary"
        :data-testid="`${testidPrefix}-${action}-back`"
        :disabled="pending"
        @click="onBack"
      >
        戻る
      </BaseButton>
      <BaseButton
        :data-testid="`${testidPrefix}-${action}-${isConfirm ? 'submit' : 'next'}`"
        :disabled="pending"
        :loading="pending"
        @click="onPrimary"
      >
        {{ primaryLabel }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/* 入力欄の間隔は検索カード（FormGrid）と同じに揃える */
.balance-adjust-dialog__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 確認ステップの定義リスト。左にラベル、右に値の 2 列の表として読ませる */
.balance-adjust-dialog__summary {
  display: grid;
  grid-template-columns: 8.5em 1fr;
  margin-top: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.balance-adjust-dialog__summary dt,
.balance-adjust-dialog__summary dd {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
}

/* 1 行目だけは上の枠線と重ならないようにする */
.balance-adjust-dialog__summary dt:first-of-type,
.balance-adjust-dialog__summary dt:first-of-type + dd {
  border-top: none;
}

.balance-adjust-dialog__summary dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  background-color: var(--color-surface-muted);
}

/* 数量の行だけ右寄せで桁を揃える（補正前・加算・補正後を縦に読み比べる） */
.balance-adjust-dialog__summary dd.is-numeric {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>

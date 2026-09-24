<script setup>
/**
 * 発注停止・再開の確認ダイアログ。停止対象 1 件について確定を emit する。
 *   suspend … 停止理由を入力させる（必須・200 字）
 *   resume  … 入力欄を出さず、停止時の理由・日時・停止者を読み取り専用で見せる
 *             （ResumeRequest に理由は無い。停止理由は再開後も保持されるので必ず値がある）
 *
 * 開閉は呼び出し側が open で持つ（ConfirmDeleteDialog と同じ作法）。
 * この部品が持つ状態は**入力中の停止理由と、その未入力エラーだけ**。開くたびに空へ戻す。
 *
 * 文言はこの部品が持つ。画面から流し込むと、期待値が画面のシナリオと部品のシナリオに散る。
 * testidPrefix を取らないのは 1 画面専用の部品だから（使い回す ConfirmDeleteDialog とは事情が違う）。
 *
 * エラーの出し先は 2 系統（AnnouncementsView と同じ）:
 *   入力の不備       … 停止理由の FormField の error（未入力のときだけ。confirm を emit しない）
 *   サーバの拒否・障害 … error prop をダイアログ先頭の BaseAlert（400 / 409 / 422 / 通信障害）
 * 長さはサーバに見せる（maxlength で 200 字を超えては入力できない）。
 * 失敗してもダイアログは開いたまま（入力した理由を失わない）。
 *
 * 出す data-testid:
 *   incidents-control-dialog / -control-reason / -control-reason-field / -control-summary
 *   / -control-warning / -control-error / -control-cancel / -control-submit
 */
import { computed, ref, watch } from 'vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import FormField from '@/components/ui/FormField.vue'
import { formatDateTime } from '@/utils/format'

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  /** 何をするか。閉じているあいだは null になりうる */
  mode: {
    type: String,
    default: null,
    validator: (value) => value === null || ['suspend', 'resume'].includes(value),
  },
  /** 操作する停止対象（store の targets の 1 行）。閉じているあいだは null になりうる */
  target: {
    type: Object,
    default: null,
  },
  /** 操作の実行中。true のあいだは閉じることもできない（結果の行き先が無くなるため） */
  pending: {
    type: Boolean,
    default: false,
  },
  /** サーバの拒否・通信障害の理由（ApiError） */
  error: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close', 'confirm'])

/** SuspendRequest.停止理由 の maxLength */
const REASON_MAX_LENGTH = 200

/*
 * 再開の説明。テンプレートに直接書くと、日本語の途中で改行した位置が半角スペースとして描画される
 * （prettier の折り返しでも同じ）。1 つの文字列にしておけば表示は変わらない
 */
const RESUME_NOTE = '停止中に保留された発注待ちの注文は、通常のバッチ周期で順次発注されます。'

const reason = ref('')
const reasonError = ref('')

// 開くたびに入力を空へ戻す。前回の対象の理由を別の対象へ持ち越さない
watch(
  () => props.open,
  (open) => {
    if (!open) return
    reason.value = ''
    reasonError.value = ''
  },
)

const targetName = computed(() => props.target?.targetName ?? '')
const isAll = computed(() => props.target?.target === 'ALL')
const isResume = computed(() => props.mode === 'resume')

const title = computed(() => (isResume.value ? '発注再開の確認' : '発注停止の確認'))

const submitLabel = computed(() => {
  if (isResume.value) return props.pending ? '再開中…' : '再開する'
  return props.pending ? '停止中…' : '停止する'
})

// 再開のときに見せる、停止時の記録
const suspendedSummary = computed(() => [
  { label: '停止理由', value: props.target?.reason ?? '—' },
  { label: '停止日時', value: formatDateTime(props.target?.suspendedAt) },
  { label: '停止者', value: props.target?.suspendedBy ?? '—' },
])

function onClose() {
  if (props.pending) return
  emit('close')
}

function onSubmit() {
  if (props.pending) return

  // 再開は理由を取らない
  if (isResume.value) {
    emit('confirm', { reason: null })
    return
  }

  // 押す前に止められるものは画面で止める（サーバも 422 で弾く）
  reasonError.value = reason.value.trim() ? '' : '停止理由を入力してください。'
  if (reasonError.value) return

  emit('confirm', { reason: reason.value })
}
</script>

<template>
  <BaseModal :open="open" :title="title" size="sm" @close="onClose">
    <div data-testid="incidents-control-dialog" class="incident-control-dialog">
      <BaseAlert v-if="error" variant="error" data-testid="incidents-control-error">
        {{ error.message }}
      </BaseAlert>

      <template v-if="isResume">
        <p>「{{ targetName }}」の発注を再開します。{{ RESUME_NOTE }}</p>

        <dl class="incident-control-dialog__summary" data-testid="incidents-control-summary">
          <template v-for="item in suspendedSummary" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </template>

      <template v-else>
        <p>「{{ targetName }}」の発注を停止します。停止理由を入力してください。</p>

        <BaseAlert v-if="isAll" variant="warning" data-testid="incidents-control-warning">
          全ルートの発注が止まり、注文の新規受付・取消も停止します。
        </BaseAlert>
      </template>

      <FormField
        v-if="!isResume"
        v-slot="{ field }"
        label="停止理由"
        required
        :hint="`最大 ${REASON_MAX_LENGTH} 文字`"
        :error="reasonError"
        data-testid="incidents-control-reason-field"
      >
        <BaseTextarea
          v-bind="field"
          v-model="reason"
          :rows="3"
          :maxlength="REASON_MAX_LENGTH"
          :disabled="pending"
          data-testid="incidents-control-reason"
        />
      </FormField>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        data-testid="incidents-control-cancel"
        :disabled="pending"
        @click="onClose"
      >
        キャンセル
      </BaseButton>
      <BaseButton
        :variant="isResume ? 'primary' : 'danger'"
        data-testid="incidents-control-submit"
        :disabled="pending"
        :loading="pending"
        @click="onSubmit"
      >
        {{ submitLabel }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.incident-control-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 停止時の記録。左にラベル、右に値の 2 列の表として読ませる（BalanceAdjustDialog の確認と同じ形） */
.incident-control-dialog__summary {
  display: grid;
  grid-template-columns: 6em 1fr;
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.incident-control-dialog__summary dt,
.incident-control-dialog__summary dd {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--color-border);
}

/* 1 行目だけは上の枠線と重ならないようにする */
.incident-control-dialog__summary dt:first-of-type,
.incident-control-dialog__summary dt:first-of-type + dd {
  border-top: none;
}

.incident-control-dialog__summary dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  background-color: var(--color-surface-muted);
}
</style>

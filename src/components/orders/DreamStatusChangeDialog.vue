<script setup>
/**
 * STS変更（Dream状況の手動変更）の確認ダイアログ。一覧の行のプルダウンで遷移先を選ぶと開く。
 *
 * 画面モックはプルダウンを変えた瞬間に送信するが、実 API（`PUT /orders/dream-status/{order_id}`）は
 * 「登録済」へ変えるときに受付番号（受注番号）が未設定なら入力を求め、変更理由も受け取る。
 * それを入れる場所として、送信の前にこのダイアログを挟む。
 *
 * **送信はまだ繋いでいない（UI だけ先に置いている）。** 主ボタンは押せないままにし、
 * 理由をダイアログの中に出す（押せるのに何も起きないボタンを作らない）。
 * 繋ぐときは confirm に { status, receiptNumber, reason } を載せて emit し、画面がストアへ渡す。
 *
 * 開閉は呼び出し側が open で持つ（ConfirmDeleteDialog と同じ作法）。
 * この部品が持つ状態は入力中の受付番号と理由だけで、開くたびに空へ戻す。
 *
 * 出す data-testid:
 *   dream-status-change-dialog / -change-summary / -change-receipt-number / -change-reason
 *   / -change-pending / -change-cancel / -change-submit
 */
import { computed, ref, watch } from 'vue'
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import FormField from '@/components/ui/FormField.vue'
import { formatQuantity, joinWide } from '@/utils/format'

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  /** 変更する行（store の items の 1 行）。閉じているあいだは null になりうる */
  order: {
    type: Object,
    default: null,
  },
  /** 選んだ遷移先の Dream状況コード（'0' / '2' / '8' / 'C0' / 'C2'） */
  targetStatus: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])

/** 遷移先の Dream状況コードのうち「登録済」。受付番号が未設定なら入力が要る */
const REGISTERED = '2'

const receiptNumber = ref('')
const reason = ref('')

// 開くたびに入力を空へ戻す。前回の行の入力を別の行へ持ち越さない
watch(
  () => props.open,
  (open) => {
    if (!open) return
    receiptNumber.value = ''
    reason.value = ''
  },
)

/** 遷移先の名前（サーバが付ける「未登録（Dream再送待ちへ戻す）」のような説明付きの文言） */
const targetName = computed(
  () =>
    props.order?.statusTransitions.find((transition) => transition.code === props.targetStatus)
      ?.name ?? props.targetStatus,
)

const needsReceiptNumber = computed(
  () => props.targetStatus === REGISTERED && !props.order?.receiptNumber,
)

const sideLabels = { buy: '買', sell: '売' }

const summary = computed(() => {
  const order = props.order
  if (!order) return []

  const side = order.sideName || sideLabels[order.side] || '—'
  return [
    { label: '注文ID', value: `#${order.id}` },
    { label: '顧客', value: `${order.accountNumber || '—'} ${order.customerName}`.trim() },
    {
      label: '銘柄',
      value: joinWide(
        order.ticker || order.symbolCode || '—',
        `${side} ${formatQuantity(order.quantity)}`,
      ),
    },
    { label: '現在の状況', value: order.statusName || order.status || '—' },
    { label: '変更後', value: targetName.value },
  ]
})
</script>

<template>
  <BaseModal :open="open" title="Dream状況を変更しますか？" @close="emit('close')">
    <div data-testid="dream-status-change-dialog" class="dream-status-change-dialog">
      <p>Dream 側の状態を確かめてから、この注文の Dream状況を手動で変更します。</p>

      <dl class="dream-status-change-dialog__summary" data-testid="dream-status-change-summary">
        <template v-for="item in summary" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </template>
      </dl>

      <FormField
        v-if="needsReceiptNumber"
        v-slot="{ field }"
        label="Dream受付番号"
        required
        hint="登録済へ変えるときは、Dream 側で採番された受付番号が要ります"
      >
        <BaseInput
          v-bind="field"
          v-model="receiptNumber"
          placeholder="例: DR-20260928-0002"
          data-testid="dream-status-change-receipt-number"
        />
      </FormField>

      <FormField v-slot="{ field }" label="変更理由" hint="注文の履歴に記録されます">
        <BaseTextarea
          v-bind="field"
          v-model="reason"
          :rows="3"
          data-testid="dream-status-change-reason"
        />
      </FormField>

      <BaseAlert variant="info" data-testid="dream-status-change-pending">
        STS変更の送信はまだ繋いでいません（画面だけ先に置いています）。
      </BaseAlert>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        data-testid="dream-status-change-cancel"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <BaseButton data-testid="dream-status-change-submit" disabled>変更する</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.dream-status-change-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 対象の注文。左にラベル、右に値の 2 列の表として読ませる（IncidentControlDialog の記録と同じ形） */
.dream-status-change-dialog__summary {
  display: grid;
  grid-template-columns: 7em 1fr;
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.dream-status-change-dialog__summary dt,
.dream-status-change-dialog__summary dd {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--color-border);
}

/* 1 行目だけは上の枠線と重ならないようにする */
.dream-status-change-dialog__summary dt:first-of-type,
.dream-status-change-dialog__summary dt:first-of-type + dd {
  border-top: none;
}

.dream-status-change-dialog__summary dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  background-color: var(--color-surface-muted);
}
</style>

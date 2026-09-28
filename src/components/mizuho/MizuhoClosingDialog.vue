<script setup>
/**
 * みずほ注文締めの確認ダイアログ（締め / 締め解除 / 注文ファイル作成）。
 *
 * 開閉は呼び出し側が open で持ち、この部品は状態を持たない（IncidentControlDialog と同じ作法）。
 * 文言は mode ごとにこの部品が持つ。締めの文言は公開モックの confirm() のまま。
 * 注文ファイル作成は、実 API の副作用（載せた注文が発注済になり、以降は取消・訂正できない）を
 * 押す前に知らせるために確認を挟む（モックは確認なしで押せる）。
 *
 * 出す data-testid:
 *   mizuho-closing-dialog / -dialog-note / -dialog-cancel / -dialog-submit
 *
 * ⚠ 主ボタンは常に押せない。締め・締め解除・注文ファイル作成の処理が未実装のため
 *   （障害管理の最初の段と同じ。押せるのに何も起きないボタンにすると、次段で確実に嘘になる）。
 *   実装する段で disabled を外し、confirm イベントと pending / error props を足す。
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
  /** どの操作の確認か。閉じているあいだは null になりうる */
  mode: {
    type: String,
    default: null,
    validator: (value) => value === null || ['close', 'reopen', 'order-file'].includes(value),
  },
})

const emit = defineEmits(['close'])

const TEXTS = {
  close: {
    title: 'みずほ注文締めの確認',
    body: 'みずほ注文を締めます。よろしいですか？',
    submitLabel: '締める',
    submitVariant: 'primary',
  },
  reopen: {
    title: '締め解除の確認',
    body: 'みずほ注文の締めを解除し、受付中に戻します。よろしいですか？',
    submitLabel: '締めを解除する',
    submitVariant: 'danger',
  },
  'order-file': {
    title: '注文ファイル作成の確認',
    body: 'みずほの注文ファイルを作成します。ファイルに載せた注文は発注済になり、以降は取消・訂正できません。',
    submitLabel: '作成する',
    submitVariant: 'primary',
  },
}

const text = computed(() => TEXTS[props.mode] ?? null)
</script>

<template>
  <!-- 本文が短いので size="sm" -->
  <BaseModal :open="open" :title="text?.title ?? '操作の確認'" size="sm" @close="emit('close')">
    <div data-testid="mizuho-closing-dialog">
      <p v-if="text">{{ text.body }}</p>

      <BaseAlert
        variant="warning"
        data-testid="mizuho-closing-dialog-note"
        class="mizuho-closing-dialog__note"
      >
        処理は次段で実装します。この確認では締め状態も注文も変わりません。
      </BaseAlert>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        data-testid="mizuho-closing-dialog-cancel"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <!-- disabled は暫定。理由は上の JSDoc と mizuho-closing-dialog-note を参照 -->
      <BaseButton
        :variant="text?.submitVariant ?? 'primary'"
        data-testid="mizuho-closing-dialog-submit"
        disabled
      >
        {{ text?.submitLabel ?? '実行する' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.mizuho-closing-dialog__note {
  margin-top: var(--space-3);
}
</style>

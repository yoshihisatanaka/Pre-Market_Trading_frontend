<script setup>
/**
 * 障害時の運用制御（IB送信 / 注文入力）の確認ダイアログ。
 *
 * 開閉は呼び出し側が open で持ち、この部品は状態を持たない
 * （ConfirmDeleteDialog と同じ作法）。
 *
 * 文言は intent ごとにこの部品が持つ。画面から流し込むと、期待値が画面のシナリオと
 * 部品のシナリオに散る。testidPrefix を取らないのは 1 画面専用の部品だから
 * （使い回す ConfirmDeleteDialog とは事情が違う）。
 *
 * 出す data-testid:
 *   incidents-control-dialog / -control-note / -control-cancel / -control-submit
 *
 * ⚠ 主ボタン「制御する」は常に押せない。状態遷移（制御の実行）が未実装のため。
 *   押せるのに何も起きないボタンにすると「押しても何も起きないこと」をテストが守ってしまい、
 *   次段で確実に嘘になる。実装する段で disabled を外し、confirm イベントと
 *   pending / error props を足す。
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
  /** どちらの制御か。閉じているあいだは null になりうる */
  intent: {
    type: String,
    default: null,
    validator: (value) => value === null || ['ib-send', 'order-entry'].includes(value),
  },
})

const emit = defineEmits(['close'])

/* 値は公開モックの data-control-intent（ib-send / order-entry）に合わせてある */
const CONTROL_TEXTS = {
  'ib-send': {
    title: 'IB送信制御の確認',
    body: 'IB送信を制御しますか？注文情報の入力・記録は継続し、IBへの送信だけを停止します。',
  },
  'order-entry': {
    title: '注文入力制御の確認',
    body: '注文入力を制御しますか？新規の注文入力を受け付けない状態になります。',
  },
}

const text = computed(() => CONTROL_TEXTS[props.intent] ?? null)
const title = computed(() => text.value?.title ?? '運用制御の確認')
</script>

<template>
  <!-- 本文が短いので size="sm" -->
  <BaseModal :open="open" :title="title" size="sm" @close="emit('close')">
    <div data-testid="incidents-control-dialog">
      <p v-if="text">{{ text.body }}</p>

      <BaseAlert
        variant="warning"
        data-testid="incidents-control-note"
        class="incident-control-dialog__note"
      >
        実際の状態遷移は次段で実装します。この確認では運用状態は変わりません。
      </BaseAlert>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        data-testid="incidents-control-cancel"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <!-- disabled は暫定。理由は上の JSDoc と incidents-control-note を参照 -->
      <BaseButton variant="danger" data-testid="incidents-control-submit" disabled>
        制御する
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.incident-control-dialog__note {
  margin-top: var(--space-3);
}
</style>

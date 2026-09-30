<script setup>
/**
 * みずほ注文締めの確認ダイアログ（締め / 締め解除 / 注文ファイル作成）。確定を emit する。
 *
 * 開閉は呼び出し側が open で持ち、この部品は状態を持たない（IncidentControlDialog と同じ作法）。
 * 文言は mode ごとにこの部品が持つ。締めの文言は公開モックの confirm() のまま。
 * 注文ファイル作成は、実 API の副作用（載せた注文が発注済になり、以降は取消・訂正できない）を
 * 押す前に知らせるために確認を挟む（モックは確認なしで押せる）。
 * 実 API は 1 回で 1 冊しか出さないので、1 回の確定で買い・売りの 2 冊を続けて作る（呼び出し側が行う）。
 *
 * サーバの拒否・通信障害は error prop をダイアログ先頭の BaseAlert に出す。
 * 失敗してもダイアログは開いたまま（何も変わっていないので、そのまま押し直せる）。
 * pending のあいだは閉じることもできない（結果の行き先が無くなるため）。
 *
 * 出す data-testid:
 *   mizuho-closing-dialog / -dialog-error / -dialog-cancel / -dialog-submit
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
  /** 操作の実行中。true のあいだは閉じることもできない */
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

const TEXTS = {
  close: {
    title: 'みずほ注文締めの確認',
    body: 'みずほ注文を締めます。よろしいですか？',
    submitLabel: '締める',
    pendingLabel: '締めています…',
    submitVariant: 'primary',
  },
  reopen: {
    title: '締め解除の確認',
    body: 'みずほ注文の締めを解除し、受付中に戻します。よろしいですか？',
    submitLabel: '締めを解除する',
    pendingLabel: '解除しています…',
    submitVariant: 'danger',
  },
  'order-file': {
    title: '注文ファイル作成の確認',
    body: 'みずほの注文ファイル（買い・売りの 2 冊）を作成します。ファイルに載せた注文は発注済になり、以降は取消・訂正できません。',
    submitLabel: '作成する',
    pendingLabel: '作成しています…',
    submitVariant: 'primary',
  },
}

const text = computed(() => TEXTS[props.mode] ?? null)

const submitLabel = computed(() => {
  if (!text.value) return '実行する'
  return props.pending ? text.value.pendingLabel : text.value.submitLabel
})

function onClose() {
  if (props.pending) return
  emit('close')
}

function onSubmit() {
  if (props.pending) return
  emit('confirm')
}
</script>

<template>
  <!-- 本文が短いので size="sm" -->
  <BaseModal :open="open" :title="text?.title ?? '操作の確認'" size="sm" @close="onClose">
    <div data-testid="mizuho-closing-dialog" class="mizuho-closing-dialog">
      <BaseAlert v-if="error" variant="error" data-testid="mizuho-closing-dialog-error">
        {{ error.message }}
      </BaseAlert>

      <p v-if="text">{{ text.body }}</p>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        data-testid="mizuho-closing-dialog-cancel"
        :disabled="pending"
        @click="onClose"
      >
        キャンセル
      </BaseButton>
      <BaseButton
        :variant="text?.submitVariant ?? 'primary'"
        data-testid="mizuho-closing-dialog-submit"
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
.mizuho-closing-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

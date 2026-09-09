<script setup>
/**
 * マスタ一覧の削除確認ダイアログ。
 *
 * 開閉は呼び出し側が open で持ち、この部品は状態を持たない。
 * 「元に戻せません」の注意書きと危険色のボタンまでを含めて、マスタ画面で共通の体裁にする。
 *
 * 出す data-testid（testidPrefix が 'market-holidays' なら market-holidays-delete-error など）:
 *   {prefix}-delete-error / {prefix}-delete-cancel / {prefix}-delete-submit
 *
 * @see MasterFormDialog 新規追加のダイアログ（testidPrefix の作法をそろえてある）
 */
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  testidPrefix: {
    type: String,
    required: true,
  },
  /** 消す対象を 1 行で示す文字列（マスタでは日付） */
  label: {
    type: String,
    default: '',
  },
  /** 削除の実行中。true のあいだはキャンセルもできない（結果の行き先が無くなるため） */
  pending: {
    type: Boolean,
    default: false,
  },
  /** サーバに拒否された理由（ApiError）。ダイアログ内に出す */
  error: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close', 'confirm'])
</script>

<template>
  <!-- 本文が短いので size="sm"（画面モックの max-width:400px 相当） -->
  <BaseModal :open="open" title="削除確認" size="sm" @close="emit('close')">
    <BaseAlert v-if="error" variant="error" :data-testid="`${testidPrefix}-delete-error`">
      {{ error.message }}
    </BaseAlert>

    <p>
      <span class="confirm-delete-dialog__label">{{ label }}</span> を削除しますか？
    </p>
    <p class="confirm-delete-dialog__warning">この操作は元に戻せません。</p>

    <template #footer>
      <BaseButton
        variant="secondary"
        :data-testid="`${testidPrefix}-delete-cancel`"
        :disabled="pending"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <BaseButton
        variant="danger"
        :data-testid="`${testidPrefix}-delete-submit`"
        :disabled="pending"
        @click="emit('confirm')"
      >
        {{ pending ? '削除中…' : '削除する' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/* 対象の日付は等幅にはせず、桁を揃えて少し強調する（画面モックの ui-code-strong 相当）。
   一覧のセル側にも同じ 2 行があるが、scoped スタイルはここまで届かないので持たせている */
.confirm-delete-dialog__label {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* 注意書き。本文（既定色）より一段小さく、危険色で出す */
.confirm-delete-dialog__warning {
  margin-top: var(--space-2);
  color: var(--color-danger);
  font-size: var(--font-size-xs);
}
</style>

<script setup>
/**
 * マスタ一覧の新規追加ダイアログ。
 *
 * 開閉と入力値は呼び出し側が持ち、この部品は「枠とエラーの出し先」だけを共通化する。
 * 入力項目（FormField 群）は既定スロットに差す。項目数・maxlength・必須エラーの文言は
 * 画面ごとの仕様なので、この部品は関知しない。
 *
 * エラーの出し先は 3 つに分かれる。
 *   入力の不備      … 呼び出し側が FormField の error に渡す（項目の直下）
 *   事前検証の不合格 … validationErrors をここで箇条書きにする（複数返ることがある）
 *   通信・サーバ障害 … error をここで 1 行出す
 *
 * 出す data-testid（testidPrefix が 'blocked-dates' なら blocked-dates-add-form など）:
 *   {prefix}-add-form / {prefix}-add-validation-error / {prefix}-add-error
 *   / {prefix}-add-cancel / {prefix}-add-submit
 *
 * @see ConfirmDeleteDialog 削除確認のダイアログ
 */
import BaseAlert from '@/components/ui/BaseAlert.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  testidPrefix: {
    type: String,
    required: true,
  },
  /** 登録の実行中。true のあいだはキャンセルもできない（結果の行き先が無くなるため） */
  pending: {
    type: Boolean,
    default: false,
  },
  /** 通信・サーバ障害の理由（ApiError） */
  error: {
    type: Object,
    default: null,
  },
  /** サーバの事前検証が返した理由。事前検証を持たない画面は渡さない */
  validationErrors: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close', 'submit'])
</script>

<template>
  <BaseModal :open="open" :title="title" @close="emit('close')">
    <!-- 送信ボタンはモーダルのフッタ（この form の外）にあるので、
         ここでの submit は入力欄での Enter キーのためだけにある -->
    <form
      :data-testid="`${testidPrefix}-add-form`"
      class="master-form-dialog__form"
      @submit.prevent="emit('submit')"
    >
      <!-- サーバの事前検証が返した理由。複数返ることがあるので箇条書きで出す -->
      <BaseAlert
        v-if="validationErrors.length > 0"
        variant="error"
        :data-testid="`${testidPrefix}-add-validation-error`"
      >
        <ul class="master-form-dialog__validation-errors">
          <li v-for="message in validationErrors" :key="message">{{ message }}</li>
        </ul>
      </BaseAlert>

      <BaseAlert v-if="error" variant="error" :data-testid="`${testidPrefix}-add-error`">
        {{ error.message }}
      </BaseAlert>

      <slot />
    </form>

    <template #footer>
      <BaseButton
        variant="secondary"
        :data-testid="`${testidPrefix}-add-cancel`"
        :disabled="pending"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <BaseButton
        :data-testid="`${testidPrefix}-add-submit`"
        :disabled="pending"
        @click="emit('submit')"
      >
        {{ pending ? '追加中…' : '追加' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/* 入力欄の間隔は検索カード（FormGrid）と同じに揃える */
.master-form-dialog__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 事前検証の理由。1 件のときも箇条書きの体裁が浮かないよう、記号と字下げは付けない */
.master-form-dialog__validation-errors {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>

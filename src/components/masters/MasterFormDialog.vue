<script setup>
/**
 * マスタ一覧の入力ダイアログ（新規追加・編集で共用する）。
 *
 * 開閉と入力値は呼び出し側が持ち、この部品は「枠とエラーの出し先」だけを共通化する。
 * 入力項目（FormField 群）は既定スロットに差す。項目数・maxlength・必須エラーの文言は
 * 画面ごとの仕様なので、この部品は関知しない。
 *
 * エラーの出し先は 3 つに分かれる。
 *   入力の不備      … 呼び出し側が FormField の error に渡す（項目の直下）
 *   事前検証の不合格 … validationErrors をここで箇条書きにする（複数返ることがある）
 *   通信・サーバ障害 … error をここで 1 行出す
 *   （楽観的ロックの競合 409 も「通信・サーバ障害」と同じ枠に出す。呼び出し側は分岐しない）
 *
 * 出す data-testid（testidPrefix が 'blocked-dates'、action が既定の 'add' なら
 * blocked-dates-add-form など。編集で開くときは action="edit" にして -edit- に振り替える）:
 *   {prefix}-{action}-form / {prefix}-{action}-validation-error / {prefix}-{action}-error
 *   / {prefix}-{action}-cancel / {prefix}-{action}-submit
 *
 * @see ConfirmDeleteDialog 削除確認のダイアログ
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
  title: {
    type: String,
    required: true,
  },
  testidPrefix: {
    type: String,
    required: true,
  },
  /** data-testid に挟む操作の名前。編集で開くときだけ 'edit' を渡す */
  action: {
    type: String,
    default: 'add',
  },
  /** 送信ボタンの文言。実行中は「〈この文言〉中…」になる */
  submitLabel: {
    type: String,
    default: '追加',
  },
  /** 登録・更新の実行中。true のあいだはキャンセルもできない（結果の行き先が無くなるため） */
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

// 「追加」→「追加中…」/「更新」→「更新中…」。動詞に「中…」を足すだけで通る文言を渡す前提
const pendingLabel = computed(() => `${props.submitLabel}中…`)
</script>

<template>
  <BaseModal :open="open" :title="title" @close="emit('close')">
    <!-- 送信ボタンはモーダルのフッタ（この form の外）にあるので、
         ここでの submit は入力欄での Enter キーのためだけにある -->
    <form
      :data-testid="`${testidPrefix}-${action}-form`"
      class="master-form-dialog__form"
      @submit.prevent="emit('submit')"
    >
      <!-- サーバの事前検証が返した理由。複数返ることがあるので箇条書きで出す -->
      <BaseAlert
        v-if="validationErrors.length > 0"
        variant="error"
        :data-testid="`${testidPrefix}-${action}-validation-error`"
      >
        <ul class="master-form-dialog__validation-errors">
          <li v-for="message in validationErrors" :key="message">{{ message }}</li>
        </ul>
      </BaseAlert>

      <BaseAlert v-if="error" variant="error" :data-testid="`${testidPrefix}-${action}-error`">
        {{ error.message }}
      </BaseAlert>

      <slot />
    </form>

    <template #footer>
      <BaseButton
        variant="secondary"
        :data-testid="`${testidPrefix}-${action}-cancel`"
        :disabled="pending"
        @click="emit('close')"
      >
        キャンセル
      </BaseButton>
      <BaseButton
        :data-testid="`${testidPrefix}-${action}-submit`"
        :disabled="pending"
        @click="emit('submit')"
      >
        {{ pending ? pendingLabel : submitLabel }}
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

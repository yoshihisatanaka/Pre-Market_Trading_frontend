<script setup>
/**
 * 権限の要る画面（meta.requiredPermission）を、権限の無い利用者が開いたときの行き先。
 * router/permissionGuard.js がここへ回す。
 *
 * /auth/me が読めずに権限なしへ倒したときは、そのことを出し分ける
 * （「権限が無い」と出すと、実際は通信の失敗なのに権限の申請へ回ってしまう）。
 */
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { useCurrentOperatorStore } from '@/stores/currentOperator'

const { error } = storeToRefs(useCurrentOperatorStore())
</script>

<template>
  <!-- 見出し「アクセス権限がありません」はヘッダが meta.title から出す -->
  <section class="forbidden" data-testid="forbidden">
    <p v-if="error" data-testid="forbidden-check-failed">
      権限を確認できませんでした（{{ error.message }}）。時間をおいて開き直してください。
    </p>
    <p v-else data-testid="forbidden-message">この画面を開く権限がありません。</p>
    <RouterLink to="/">注文一覧へ戻る</RouterLink>
  </section>
</template>

<style scoped>
.forbidden {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}
</style>

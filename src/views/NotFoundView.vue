<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <!-- 見出し「ページが見つかりません」はヘッダが meta.title から出す -->
  <section class="not-found">
    <p>URL をご確認ください。</p>
    <RouterLink to="/">注文一覧へ戻る</RouterLink>
  </section>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}
</style>

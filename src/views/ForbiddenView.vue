<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <!--
    権限の無い画面を開いたときの行き先（router/index.js のガードがここへ回す）。
    見出し「アクセス権限がありません」はヘッダが meta.title から出す
  -->
  <section class="forbidden" data-testid="forbidden">
    <p>この画面を表示する権限がありません。必要な場合は管理責任者にお問い合わせください。</p>
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

<script setup>
/**
 * 画面上のひとまとまり（検索条件・一覧・説明など）を載せる面。
 * title を渡すとヘッダ行が出る。ヘッダ右側は header-actions スロットに置く（件数表示やボタン）。
 *
 * flush を付けると本文の余白が無くなる。テーブルをカード幅いっぱいに載せるときに使う。
 */
defineProps({
  title: {
    type: String,
    default: '',
  },
  flush: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <section class="card">
    <header v-if="title || $slots['header-actions']" class="card__header">
      <span class="card__title">{{ title }}</span>
      <slot name="header-actions" />
    </header>

    <div :class="['card__body', { 'is-flush': flush }]">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-border);
}

.card__title {
  color: var(--color-text-heading);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.card__body {
  padding: var(--space-4) var(--space-5);
}

.card__body.is-flush {
  padding: 0;
}
</style>

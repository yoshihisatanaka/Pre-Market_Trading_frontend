<script setup>
/**
 * フォーム項目を等幅の列に並べる（モックの .grid-2 / .grid-3 / .grid-4 相当）。
 * 中身は FormField を想定するが、何を並べるかは関知しない。
 * 画面幅が狭いときは 2 列 → 1 列へ自動的に畳む。
 */
defineProps({
  columns: {
    type: Number,
    default: 4,
    validator: (value) => [2, 3, 4].includes(value),
  },
})
</script>

<template>
  <div :class="['form-grid', `form-grid--${columns}`]">
    <slot />
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  gap: var(--space-3);
  /* ヒントやエラーの有無で入力欄の高さが変わるため、上端で揃える
     （モックは align-items: end だが、あちらには補助文が無かった） */
  align-items: start;
}

.form-grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid--4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 900px) {
  .form-grid--3,
  .form-grid--4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .form-grid--2,
  .form-grid--3,
  .form-grid--4 {
    grid-template-columns: 1fr;
  }
}
</style>

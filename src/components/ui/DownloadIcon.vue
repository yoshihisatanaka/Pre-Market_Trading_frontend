<script setup>
/**
 * ダウンロードのアイコン（画面モックの CSV 出力ボタンが頭に付けているもの）。
 * ボタンのラベルの前に置く飾りなので読み上げない（aria-hidden）。
 * 色は文字色（currentColor）に従う。大きさは既定の 15px（モックの .btn svg）で、
 * 変えるときは呼び出し側が class で上書きする。
 */
</script>

<template>
  <svg
    class="download-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
</template>

<style scoped>
.download-icon {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
}
</style>

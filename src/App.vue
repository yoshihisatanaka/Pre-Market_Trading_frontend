<script setup>
import { storeToRefs } from 'pinia'
import { RouterView } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import AppLoadingOverlay from '@/components/layout/AppLoadingOverlay.vue'
import { useCodesStore } from '@/stores/codes'

/*
 * 起動時のコードマスタ取得が終わるまで画面全体を覆う。
 * 読み込みを始めるのは main.js（マウント前）で、ここは状態を見て覆うだけ。
 *
 * AppLayout は覆っている間も描き続ける（v-if で隠さない）。
 * 骨格まで消すと、覆いが外れた瞬間にレイアウトが組み上がる形になって画面が跳ねる。
 */
const codes = useCodesStore()
const { loading: codesLoading, error: codesError } = storeToRefs(codes)
</script>

<template>
  <AppLayout>
    <RouterView />
  </AppLayout>

  <AppLoadingOverlay :loading="codesLoading" :error="codesError" @retry="codes.load()" />
</template>

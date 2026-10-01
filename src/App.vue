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
 *
 * 画面（RouterView）だけは取得に成功するまで描かない。プルダウンの選択肢はすべてコードマスタから
 * 来るので、画面の setup が走る時点で選択肢が揃っていることを保証する（URL クエリの値を
 * 選択肢で検査する画面が、空の選択肢で検査して値を捨てないように）。
 */
const codes = useCodesStore()
const { loading: codesLoading, error: codesError, ready: codesReady } = storeToRefs(codes)
</script>

<template>
  <AppLayout>
    <RouterView v-if="codesReady" />
  </AppLayout>

  <AppLoadingOverlay :loading="codesLoading" :error="codesError" @retry="codes.load()" />
</template>

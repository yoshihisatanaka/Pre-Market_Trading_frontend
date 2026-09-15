<script setup>
/**
 * 起動時に画面全体を覆うローディング。
 *
 * index.html のスプラッシュ（バンドル読込中の表示）から引き継ぎ、コードマスタの取得が
 * 終わるまで覆い続ける。これで「白い画面 → 組み立て途中の画面」の 2 段の空白が消える。
 *
 * 見た目はサイドバーと同じ濃紺の面にシステム名を置いた「起動画面」にしてある。
 * 薄いグレーの面に回転マークだけを置くと、読み込みに失敗して止まった画面と区別が付かない。
 * index.html のスプラッシュと**同じ配色・同じ寸法**にしてあるので、マウントの前後で
 * 継ぎ目が見えない。片方を変えたらもう片方も直すこと。
 *
 * この部品は状態を持たずストアも読まない。loading / error を props で受け、
 * 「再試行」は retry で外へ出すだけにする（配線は App.vue が持つ）。
 * MasterSearchCard と同じ作法で、表示だけの部品として単体で試せるようにしてある。
 *
 * 取得に失敗したら理由と「再試行」を出し、覆ったまま先へ進ませない。
 * 選択肢が空のまま操作させないため。
 *
 * 出す data-testid: app-loading / app-loading-error / app-loading-retry
 * （既存の `{prefix}-loading` は各画面の一覧が使っているので、それとは別系統の名前にする）
 */
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'

defineProps({
  loading: {
    type: Boolean,
    required: true,
  },
  /** 取得に失敗した理由（ApiError）。message をそのまま出せる */
  error: {
    type: Object,
    default: null,
  },
})

defineEmits(['retry'])
</script>

<template>
  <!-- 読み直し中は前回の失敗を見せない（loading を先に見る） -->
  <div v-if="loading || error" class="app-loading-overlay">
    <div class="app-loading-overlay__inner">
      <p class="app-loading-overlay__wordmark">米株発注システム</p>

      <div v-if="loading" data-testid="app-loading" class="app-loading-overlay__status">
        <!-- 読み上げは下の文言に任せる（回転マークが「読み込み中」と二重に喋らないように） -->
        <BaseSpinner size="lg" label="" />
        <p role="status" class="app-loading-overlay__caption">読み込んでいます</p>
      </div>

      <div v-else data-testid="app-loading-error" class="app-loading-overlay__error">
        <p>{{ error.message }}</p>
        <BaseButton variant="secondary" data-testid="app-loading-retry" @click="$emit('retry')">
          再試行
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-loading-overlay {
  /*
   * 回転マークを「薄い軌道＋白い弧」にする（BaseSpinner の既定を濃い面用に差し替える）。
   * 濃紺の上では 3 辺を白で描く既定の形より、軌道が見えるほうが落ち着いて見える。
   */
  --base-spinner-track: var(--color-sidebar-border);
  --base-spinner-arc: var(--color-sidebar-text-active);

  position: fixed;
  inset: 0;
  /*
   * BaseModal の 1000 より手前に置く。両方が同時に出る場面は原理的に無い
   * （覆っている間はモーダルを開けない）が、万一この覆いが残ったときに
   * モーダルの裏へ回ると「何が起きているか判らない画面」になるため。
   */
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  /* サイドバーと同じ濃紺。起動画面であることが一目で判る */
  background-color: var(--color-sidebar-bg);
}

.app-loading-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-6);
}

/* サイドバーのシステム名と同じ見せかた（字間を広げて据わりを良くする） */
.app-loading-overlay__wordmark {
  color: var(--color-sidebar-text-active);
  font-size: var(--font-size-xl);
  font-weight: 600;
  letter-spacing: 0.18em;
  /* letter-spacing は文字の右側に入るので、その分だけ左へ戻して中央に見せる */
  text-indent: 0.18em;
}

.app-loading-overlay__status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}

.app-loading-overlay__caption {
  color: var(--color-sidebar-section);
  font-size: var(--font-size-sm);
  letter-spacing: 0.08em;
}

/* 失敗したときだけ、濃紺の上に白い面を起こして理由を読ませる */
.app-loading-overlay__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  max-width: 480px;
  padding: var(--space-6);
  color: var(--color-danger);
  text-align: center;
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
}
</style>

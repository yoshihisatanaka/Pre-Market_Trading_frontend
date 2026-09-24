<script setup>
/**
 * 全画面共通のヘッダ。
 * 画面タイトルは各 view ではなく、ここが router の meta.title から描画する。
 * 画面固有の操作ボタンは view 側から <Teleport defer to="#topbar-actions"> で差し込む。
 *
 * 左端のメニューボタンはサイドメニューの開閉操作。押し出し式で畳むとサイドメニューは
 * 画面外に出るので、トグルは常時見えているこちら側に置く。状態は持たず通知するだけ。
 *
 * 市場ステータスと取引時間帯は `GET /market-status` の応答が出どころで、**ここでは
 * 時刻から推定しない**（祝日・短縮取引を知らない推定を実データと同じ見た目で出さない）。
 * 取れていなければ「—」を出す。組み立ては composable → store → api の順に通す
 * （component から api 層は import できない）。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMarketStatus } from '@/composables/useMarketStatus'

defineProps({
  /** サイドメニューが展開しているか。ボタンの aria-expanded に映すだけで、自分では変えない */
  sidebarOpen: {
    type: Boolean,
    default: true,
  },
})

defineEmits(['toggle-sidebar'])

const route = useRoute()
const title = computed(() => route.meta.title ?? '')
const market = useMarketStatus()
</script>

<template>
  <header class="topbar">
    <div class="topbar__left">
      <!--
        名前は状態で変えない（状態は aria-expanded の役割）。
        nav の「メインメニュー」と同名にしないこと。
      -->
      <button
        type="button"
        data-testid="sidebar-toggle"
        class="topbar__menu"
        aria-label="メニューの開閉"
        aria-controls="app-sidebar"
        :aria-expanded="sidebarOpen ? 'true' : 'false'"
        @click="$emit('toggle-sidebar')"
      >
        <!-- アイコンライブラリは入れていない。線はサイドメニューと同じ流儀（24 viewBox / stroke 2） -->
        <svg
          class="topbar__menu-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <h1 class="topbar__title">{{ title }}</h1>
    </div>

    <div class="topbar__right">
      <!--
        ラベル・目印・時間帯グリッドをまとめた塊。
        market-status は**ラベルだけを包む**（E2E の LAY-02 が完全一致で見ている）。
      -->
      <div data-testid="market" class="market" :title="market.title || undefined">
        <span
          data-testid="market-status"
          :data-status="market.key"
          :class="['market-status', `market-status--${market.key}`]"
        >
          {{ market.label }}
        </span>

        <span v-if="market.shortened" data-testid="market-shortened" class="market-flag">
          短縮取引
        </span>

        <!-- 休場理由、または取得できなかった旨 -->
        <span v-if="market.note" data-testid="market-note" class="market-note">
          {{ market.note }}
        </span>

        <!--
          3 セッション × JST / ET の 2 行グリッド。休場と未取得では出さない。
          時刻は列の右端で揃える（JST 側は名前 + 時刻、ET 側は時刻だけのため）。
        -->
        <div v-if="market.sessions.length" data-testid="market-hours" class="market-hours">
          <span class="market-hours__zone">JST</span>
          <span
            v-for="session in market.sessions"
            :key="`jst-${session.code}`"
            :data-session="session.code"
            :data-current="session.current || null"
            :class="[
              'market-hours__cell',
              `market-hours__cell--${session.key}`,
              { 'market-hours__cell--current': session.current },
            ]"
          >
            <span class="market-hours__name">{{ session.name }}</span>
            <span class="market-hours__time">{{ session.hoursJst }}</span>
          </span>

          <span class="market-hours__zone">ET</span>
          <span
            v-for="session in market.sessions"
            :key="`et-${session.code}`"
            :data-session="session.code"
            :data-current="session.current || null"
            :class="[
              'market-hours__cell',
              `market-hours__cell--${session.key}`,
              { 'market-hours__cell--current': session.current },
            ]"
          >
            <span class="market-hours__time">{{ session.hoursEt }}</span>
          </span>
        </div>
      </div>

      <!-- 画面固有のボタンの差し込み先。中身は各 view が Teleport で入れる -->
      <div id="topbar-actions" data-testid="topbar-actions" class="topbar__actions"></div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.topbar__left {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

/*
 * 面を塗らないアイコンボタンは BaseButton の 4 variant に無い。1 箇所のために
 * 共通部品を広げず素の button で持つ（同じ形が 2 個目に出たら BaseButton へ寄せる）。
 */
.topbar__menu {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.topbar__menu:hover {
  background-color: var(--color-bg);
  color: var(--color-text);
}

.topbar__menu:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

/* --space-* は余白の尺度なので、アイコンの寸法は直値で持つ（既存方針） */
.topbar__menu-icon {
  width: 20px;
  height: 20px;
}

/*
 * 時間帯グリッドで右側が幅を取るようになったので、狭い画面ではタイトルを詰める。
 * 折り返させるとヘッダの高さが変わってしまうため、省略記号で切る。
 */
.topbar__title {
  overflow: hidden;
  min-width: 0;
  color: var(--color-text-heading);
  font-size: var(--font-size-xl);
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.topbar__right,
.topbar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.market-status {
  font-size: var(--font-size-sm);
  font-weight: 500;
  white-space: nowrap;
}

.market-status--premarket {
  color: var(--color-market-premarket);
}

.market-status--regular {
  color: var(--color-market-regular);
}

.market-status--afterhours {
  color: var(--color-market-afterhours);
}

.market-status--closed {
  color: var(--color-market-closed);
}

/* まだ取れていない・取れなかった。推定を出さないので色も付けない */
.market-status--unknown {
  color: var(--color-text-muted);
}

.market {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
}

/* 短縮取引の目印と、休場理由・取得失敗の断り書き */
.market-flag,
.market-note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.market-flag {
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

/*
 * 3 セッション × JST / ET の 2 行グリッド。
 * 列幅は内容任せで、セルの中身は右端で揃える（JST 行は「名前 + 時刻」、ET 行は時刻だけなので、
 * 右揃えにしないと時刻の位置が 2 行でずれる）。
 */
.market-hours {
  display: grid;
  grid-template-columns: auto repeat(3, auto);
  align-items: center;
  gap: 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.market-hours__zone {
  font-weight: 600;
  white-space: nowrap;
}

.market-hours__cell {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
  white-space: nowrap;
}

/* 桁が揃うと 2 行の時刻が読み比べやすい */
.market-hours__time {
  font-family: var(--font-family-numeric);
}

.market-hours__cell--current {
  font-weight: 600;
}

/* 色が付くのは現在のセッションの列だけ。残りは muted のまま背景に退く */
.market-hours__cell--current.market-hours__cell--premarket {
  color: var(--color-market-premarket);
}

.market-hours__cell--current.market-hours__cell--regular {
  color: var(--color-market-regular);
}

.market-hours__cell--current.market-hours__cell--afterhours {
  color: var(--color-market-afterhours);
}
</style>

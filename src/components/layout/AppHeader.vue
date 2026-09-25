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
 *
 * 見た目はモック 08986d1 のバッジ 1 個（丸印・ラベル・JST 側・ET 側）。
 * 基準日・3 セッション・短縮取引の理由は title（ホバー）にだけ出す。
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
        丸印・ラベル・JST 側・ET 側をまとめたバッジ。配色は data-status（= key）ごとに変わる。
        market-status は**ラベルだけを包む**（E2E の LAY-02 が完全一致で見ている）。
        JST 側には時間帯のほか、休場理由と取得できなかった旨も入る。
      -->
      <div
        data-testid="market"
        :data-status="market.key"
        :class="['market', `market--${market.key}`]"
        :title="market.title || undefined"
      >
        <span class="market__marker" aria-hidden="true"></span>
        <span data-testid="market-status" class="market__label">{{ market.label }}</span>
        <span v-if="market.jst" data-testid="market-jst" class="market__jst">{{ market.jst }}</span>
        <span v-if="market.et" data-testid="market-et" class="market__et">{{ market.et }}</span>
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
 * 市場ステータスのバッジで右側が幅を取るので、狭い画面ではタイトルを詰める。
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

/*
 * 市場ステータスのバッジ（モック 08986d1）。
 * 寸法は最寄りのトークンに丸める（gap 9px → space-2、padding 13px → space-3、角丸 4px → radius-sm、
 * ラベル 16px → font-size-lg）。高さ 40px と丸印 9px は寸法なので直値。
 */
.market {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-market-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  color: var(--color-market-text);
  white-space: nowrap;
}

.market__marker {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background-color: var(--color-market-marker);
}

.market__label {
  font-size: var(--font-size-lg);
  font-weight: 700;
}

/* 区切り線はラベルと同じ色（currentColor）で引く */
.market__jst {
  padding-left: var(--space-2);
  border-left: 1px solid currentColor;
  color: var(--color-label);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.market__et {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.market--premarket {
  border-color: var(--color-market-pre-border);
  background-color: var(--color-market-pre-bg);
  color: var(--color-market-pre-text);
}

.market--premarket .market__marker {
  background-color: var(--color-market-pre-marker);
}

.market--regular {
  border-color: var(--color-market-regular-border);
  background-color: var(--color-market-regular-bg);
  color: var(--color-market-regular-text);
}

.market--regular .market__marker {
  background-color: var(--color-market-regular-marker);
}

.market--afterhours {
  border-color: var(--color-market-after-border);
  background-color: var(--color-market-after-bg);
  color: var(--color-market-after-text);
}

.market--afterhours .market__marker {
  background-color: var(--color-market-after-marker);
}

.market--holiday {
  border-color: var(--color-market-holiday-border);
  background-color: var(--color-market-holiday-bg);
  color: var(--color-market-holiday-text);
}

.market--holiday .market__marker {
  background-color: var(--color-market-holiday-marker);
}

.market--closed {
  border-color: var(--color-market-closed-border);
  background-color: var(--color-market-closed-bg);
  color: var(--color-market-closed-text);
}

.market--closed .market__marker {
  background-color: var(--color-market-closed-marker);
}
</style>

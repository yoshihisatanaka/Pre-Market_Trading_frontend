<script setup>
/**
 * 全画面共通のサイドメニュー。
 * 項目は navigation.js が正。ここに直接リンクを書き足さないこと。
 *
 * 開閉状態は自分では持たず、所有者（AppLayout）から open で受け取る。
 * 押し出し式なので、閉じると板ごと画面外へ出て本文が全幅になる。
 *
 * 権限の要る区分（requiredPermission）は、その権限を持つ利用者にだけ出す。
 * /auth/me を読み終えるまでは持っていない扱いにする（出てから消えるちらつきを防ぐ）。
 * 読み込みを始めるのは main.js で、ここは結果を見るだけ。画面そのものの制限は router の permissionGuard。
 *
 * 区分ごとのアコーディオンの開閉はここで持つ（板全体の開閉とは別物）。初期値は navigation.js の defaultOpen。
 * 現在のページを含む区分は、遷移のたびに開く（畳んだ区分の中にいて現在地が見えなくならないように）。
 * 畳んだ区分のリンクは v-show で隠すだけで、DOM には残す。
 *
 * 画面は遅延 import なので、押してからチャンクが届くまで遷移が確定せず aria-current も動かない。
 * その間は pendingPath（所有者の AppLayout が router から配る）に一致する項目を読み込み中の見た目にし、
 * 押した瞬間に反応が返るようにする。マウスが乗った / フォーカスした時点でチャンクを先読みするのも
 * 同じ理由（loadRouteLocation は解決済みなら何もしない）。
 *
 * 項目の件数（navigation.js の badge。注文エラー / Dream登録エラー）は、画面を移るたびに取り直す
 * （画面モックはページを開くたびにサーバが数え直す）。同じ画面で検索条件（クエリ）だけが変わっても取り直さない。
 * 件数はリンク名に混ぜない（E2E と読み上げがラベルで項目を指すため）。読み上げには aria-describedby で添える。
 * 件数を出している間はリンクに aria-label（ラベルと同じ文字列）も付ける。数字は aria-hidden、読み上げ文は hidden だが、
 * 隠れた要素も数える名前の計算（Playwright の includeHidden: true）では中身が名前に混ざるため。
 */
import { computed, reactive, watch } from 'vue'
import { RouterLink, loadRouteLocation, useRoute, useRouter } from 'vue-router'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import { useNavBadgesStore } from '@/stores/navBadges'
import { navSections } from './navigation'

defineProps({
  /** 展開しているか。既定は展開（畳むのは呼び出し側の明示的な指定） */
  open: {
    type: Boolean,
    default: true,
  },
  /** 遷移の確定待ちの行き先（path）。一致する項目を読み込み中の見た目にする。空なら無し */
  pendingPath: {
    type: String,
    default: '',
  },
})

const operator = useCurrentOperatorStore()
const router = useRouter()

/** 行き先のチャンクを先に取りに行く。全 record が redirect のときだけ reject するので握りつぶす */
const prefetch = (to) => loadRouteLocation(router.resolve(to)).catch(() => {})

const visibleSections = computed(() =>
  navSections.filter(
    (section) => !section.requiredPermission || operator.can(section.requiredPermission),
  ),
)

/** 区分ラベル → 開いているか */
const expanded = reactive(
  Object.fromEntries(navSections.map((section) => [section.label, section.defaultOpen !== false])),
)

function toggleSection(section) {
  expanded[section.label] = !expanded[section.label]
}

/** 配下のページ（/masters/symbols/… など）にいるときも、その項目の区分を現在地とみなす */
const containsPath = (section, path) =>
  section.items.some((item) => path === item.to || path.startsWith(`${item.to}/`))

const route = useRoute()
watch(
  () => route.path,
  (path) => {
    const current = navSections.find((section) => containsPath(section, path))
    if (current) expanded[current.label] = true
  },
  { immediate: true },
)

const badges = useNavBadgesStore()
watch(
  () => route.path,
  () => badges.load(),
  { immediate: true },
)

/** 項目に添える件数。badge の無い項目・未取得・0 件は 0（何も出さない） */
const badgeCount = (item) => (item.badge ? (badges.counts[item.badge.key] ?? 0) : 0)

/** 件数の読み上げ文（「注文エラー 3 件」）を置く要素の id */
const badgeLabelId = (item) => `sidebar-badge-${item.badge.key}-label`
</script>

<template>
  <!--
    inert は Vue の「特別な boolean 属性」ではないため :inert="!open" と書くと
    inert="false" が属性として残り、開いているのに操作できなくなる環境がある。
    畳んだときだけ true を渡し、開いているときは undefined で属性ごと消す。
  -->
  <aside
    id="app-sidebar"
    data-testid="app-sidebar"
    class="sidebar"
    :class="{ 'is-collapsed': !open }"
    :inert="open ? undefined : true"
  >
    <div class="sidebar__logo">
      <div class="sidebar__logo-title">米株発注システム</div>
    </div>

    <nav class="sidebar__nav" aria-label="メインメニュー">
      <template v-for="section in visibleSections" :key="section.label">
        <!-- 見出しの中にボタンを置く（見出しとしての読み上げと、開閉ボタンとしての操作を両立させる） -->
        <h2 class="sidebar__section">
          <button
            type="button"
            class="sidebar__section-toggle"
            :class="{ 'is-closed': !expanded[section.label] }"
            :aria-expanded="String(expanded[section.label])"
            :aria-controls="`sidebar-section-${section.label}`"
            @click="toggleSection(section)"
          >
            {{ section.label }}
            <svg
              class="sidebar__chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </h2>
        <div v-show="expanded[section.label]" :id="`sidebar-section-${section.label}`">
          <RouterLink
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="sidebar__link"
            :class="{ 'is-pending': item.to === pendingPath }"
            active-class="is-active"
            :aria-label="badgeCount(item) > 0 ? item.label : undefined"
            :aria-describedby="badgeCount(item) > 0 ? badgeLabelId(item) : undefined"
            @pointerenter="prefetch(item.to)"
            @focus="prefetch(item.to)"
          >
            {{ item.label }}
            <!-- 数字は見た目だけ（リンク名は aria-label のラベル）。読み上げは hidden の文を aria-describedby で指す -->
            <template v-if="badgeCount(item) > 0">
              <span
                class="sidebar__badge"
                aria-hidden="true"
                :data-testid="`sidebar-badge-${item.badge.key}`"
              >
                {{ badgeCount(item) }}
              </span>
              <span :id="badgeLabelId(item)" hidden>
                {{ item.badge.label }} {{ badgeCount(item) }} 件
              </span>
            </template>
            <!-- 読み上げは AppLayout のバーに任せる（リンク名をラベルだけに保つ） -->
            <BaseSpinner
              v-if="item.to === pendingPath"
              size="sm"
              label=""
              class="sidebar__pending"
            />
          </RouterLink>
        </div>
      </template>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  /* 1 箇所で持ち、prefers-reduced-motion で 0 に潰す（BaseSpinner と同じ作法） */
  --sidebar-transition-duration: 0.2s;

  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--layout-sidebar-width);
  overflow-y: auto;
  background-color: var(--color-sidebar-bg);
  transition:
    margin-left var(--sidebar-transition-duration) ease,
    visibility 0s linear 0s;
}

/*
 * 幅を 0 に縮めるとラベルが折り返して「潰れる」動きになるので、幅は保ったまま
 * 板ごと左へ出す（はみ出しは .app-layout の overflow: hidden がクリップする）。
 * visibility は畳み終わってから掛ける。矩形が残ったままだと「見えている」と判定され、
 * 閉じたことを検証できない。
 */
.sidebar.is-collapsed {
  margin-left: calc(var(--layout-sidebar-width) * -1);
  visibility: hidden;
  transition:
    margin-left var(--sidebar-transition-duration) ease,
    visibility 0s linear var(--sidebar-transition-duration);
}

.sidebar__logo {
  padding: var(--space-5) var(--space-4);
  border-bottom: 1px solid var(--color-sidebar-border);
}

.sidebar__logo-title {
  color: var(--color-sidebar-text-active);
  font-size: var(--font-size-lg);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.01em;
}

.sidebar__nav {
  flex: 1;
  padding: var(--space-4) var(--space-3);
}

.sidebar__section {
  margin: var(--space-3) 0 var(--space-1);
  color: var(--color-sidebar-section);
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* 2 区分目以降は上に区切り線を引き、畳んだ区分が続いても境目が分かるようにする */
.sidebar__section:not(:first-child) {
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-sidebar-divider);
}

.sidebar__section:first-child {
  margin-top: 0;
}

/* ボタンの既定の装飾を外し、押せる範囲を見出しの幅いっぱいに広げる */
.sidebar__section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.sidebar__section-toggle:hover {
  background-color: var(--color-sidebar-hover);
  color: var(--color-sidebar-text-active);
}

.sidebar__section-toggle:focus-visible,
.sidebar__link:focus-visible {
  outline: 2px solid var(--color-sidebar-accent);
  outline-offset: -2px;
}

/* 見出しの文字を主にするため、矢印は一段落とす */
.sidebar__chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  opacity: 0.7;
  transition:
    transform var(--sidebar-transition-duration) ease,
    opacity 0.15s ease;
}

.sidebar__section-toggle:hover .sidebar__chevron {
  opacity: 1;
}

/* 閉じているときは右向き（開くと下向きに戻る） */
.sidebar__section-toggle.is-closed .sidebar__chevron {
  transform: rotate(-90deg);
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-sidebar-text);
  font-size: var(--font-size-md);
  text-decoration: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.sidebar__link + .sidebar__link {
  margin-top: 2px;
}

.sidebar__link:hover,
.sidebar__link.is-pending {
  background-color: var(--color-sidebar-hover);
  color: var(--color-sidebar-text-active);
}

/* 現在地は hover と別の面にし、左端のバーと太字で示す（バーは inset の影で描き、幅をずらさない） */
.sidebar__link.is-active {
  background-color: var(--color-sidebar-active-bg);
  box-shadow: inset 3px 0 0 var(--color-sidebar-accent);
  color: var(--color-sidebar-text-active);
  font-weight: 600;
}

/* 読み込み中の回転マークはラベルの右端に寄せる */
.sidebar__pending {
  margin-left: auto;
}

/*
 * 件数（モックの .sidebar-failure-badge）。ラベルの右端に寄せ、回転マークが出るときはその左に並ぶ。
 * 寸法はモックの値（17px 角・角丸 3px）
 */
.sidebar__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  margin-left: auto;
  padding: 0 5px;
  border-radius: 3px;
  background-color: var(--color-danger-hover);
  color: var(--color-sidebar-text-active);
  font-size: var(--font-size-xs);
  font-weight: 600;
  line-height: 1;
}

/* 間に hidden の読み上げ文が挟まるので、隣接（+）ではなく後続（~）で指す */
.sidebar__badge ~ .sidebar__pending {
  margin-left: 0;
}

/* 0s にすると visibility の遅延も 0s になり、その場で切り替わる */
@media (prefers-reduced-motion: reduce) {
  .sidebar {
    --sidebar-transition-duration: 0s;
  }
}
</style>

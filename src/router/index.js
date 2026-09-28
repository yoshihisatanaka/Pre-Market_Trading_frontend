import { createRouter, createWebHistory } from 'vue-router'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import OrderListView from '@/views/OrderListView.vue'

/*
 * meta.permission … その画面を開くのに要る権限（src/api/auth.js の permissions のキー）。
 * 持っていなければ下のガードが forbidden へ回す。
 * **マスタメンテ（/masters/*）は全画面 'master'**（マスタ更新権限。2026-09-28 決定）。
 * サイドメニュー側は navigation.js の区分に同じ権限を書いて隠す。両方をそろえること
 * （router/index.spec.js が /masters/ 配下の付け忘れを検査する）。
 */
const routes = [
  {
    path: '/',
    name: 'order-list',
    component: OrderListView,
    meta: { title: '注文一覧' },
  },
  {
    // 開発用。components/ui/ の部品を実物で見比べるための一覧。
    // 業務画面ではないので navigation.js（サイドメニュー）には載せない
    path: '/dev/ui-catalog',
    name: 'ui-catalog',
    component: () => import('@/views/UiCatalogView.vue'),
    meta: { title: 'UI カタログ' },
  },
  {
    // path は navigation.js（サイドメニュー）の項目と一致させる
    path: '/masters/customers',
    name: 'customer-list',
    component: () => import('@/views/CustomerListView.vue'),
    meta: { title: '顧客マスタ', permission: 'master' },
  },
  {
    path: '/masters/permissions',
    name: 'permission-list',
    component: () => import('@/views/PermissionListView.vue'),
    meta: { title: '権限マスタ', permission: 'master' },
  },
  {
    path: '/masters/market-holidays',
    name: 'market-holiday-list',
    component: () => import('@/views/MarketHolidayListView.vue'),
    meta: { title: '海外休場日マスタ', permission: 'master' },
  },
  {
    path: '/masters/blackout-dates',
    name: 'blackout-date-list',
    component: () => import('@/views/BlackoutDateListView.vue'),
    meta: { title: '受注不可日マスタ', permission: 'master' },
  },
  {
    path: '/masters/symbols',
    name: 'symbol-list',
    component: () => import('@/views/SymbolListView.vue'),
    meta: { title: '銘柄マスタ', permission: 'master' },
  },
  {
    path: '/masters/ca',
    name: 'corporate-action-list',
    component: () => import('@/views/CorporateActionListView.vue'),
    meta: { title: 'CAマスタ', permission: 'master' },
  },
  {
    path: '/masters/hard-limits',
    name: 'slice-criteria-master',
    component: () => import('@/views/SliceCriteriaMasterView.vue'),
    meta: { title: 'スライス基準マスタ', permission: 'master' },
  },
  {
    path: '/masters/balance-adjustments',
    name: 'balance-adjustment-list',
    component: () => import('@/views/BalanceAdjustmentListView.vue'),
    meta: { title: '残高マスタ', permission: 'master' },
  },
  {
    path: '/operations/announcements',
    name: 'announcement-management',
    component: () => import('@/views/AnnouncementsView.vue'),
    meta: { title: 'お知らせ管理' },
  },
  {
    path: '/operations/stalled-orders',
    name: 'stalled-order-list',
    component: () => import('@/views/StalledOrderListView.vue'),
    meta: { title: '滞留注文抽出' },
  },
  {
    path: '/operations/activity-logs',
    name: 'activity-log-list',
    component: () => import('@/views/ActivityLogListView.vue'),
    meta: { title: '操作ログ' },
  },
  {
    path: '/operations/incidents',
    name: 'incident-management',
    component: () => import('@/views/IncidentManagementView.vue'),
    meta: { title: '障害管理' },
  },
  {
    // 権限の無い画面を開いたときの行き先。業務画面ではないのでサイドメニューには載せない
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/views/ForbiddenView.vue'),
    meta: { title: 'アクセス権限がありません' },
  },
  {
    // 最初の画面以外は遅延 import にして初期バンドルを膨らませない
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'ページが見つかりません' },
  },
]

/**
 * meta.permission を持つ画面は、その権限を持つ操作者にだけ開かせる。
 *
 * 操作者の読み込み（main.js が起動時に始める）の完了を待ってから判定する。
 * 途中で判定すると、権限があるのに一瞬 forbidden へ回される。
 * 取得に失敗したときは権限なしとして扱う（stores/currentOperator.js）。
 *
 * forbidden へは置き換えで回す（戻るボタンで権限の無い画面へ戻り、また弾かれるのを避ける）。
 */
export async function requirePermission(to) {
  const { permission } = to.meta
  if (!permission) return true

  const operatorStore = useCurrentOperatorStore()
  await operatorStore.ensureLoaded()
  return operatorStore.hasPermission(permission) ? true : { name: 'forbidden', replace: true }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(requirePermission)

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | US Stock Order` : 'US Stock Order'
})

export { routes }
export default router

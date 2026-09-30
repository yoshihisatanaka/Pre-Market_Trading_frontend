import { createRouter, createWebHistory } from 'vue-router'
import OrderListView from '@/views/OrderListView.vue'
import { permissionGuard } from './permissionGuard'

/*
 * meta.requiredPermission を付けたルートは、その権限（GET /auth/me の権限）が無いと開けない
 * （permissionGuard）。運用管理の 4 画面は operation、**マスタメンテ（/masters/*）は全画面 master**
 * （2026-09-28 決定）。サイドメニューの区分の出し分け（navigation.js の requiredPermission）と
 * 必ず揃える。メニューだけ隠しても URL で入れてしまう（付け忘れは router/index.spec.js が検出する）。
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
    // path は navigation.js（サイドメニュー）の項目と一致させる。
    // プレビュー（/orders/csv/preview）と受付完了（/orders/csv/complete）は処理と一緒に足す
    path: '/orders/csv/upload',
    name: 'order-csv-upload',
    component: () => import('@/views/OrderCsvUploadView.vue'),
    meta: { title: 'CSV一括注文' },
  },
  {
    // 入力 → 確認 → 完了は 1 つのルートの中で段階を切り替える（再読み込みで入力へ戻る）
    path: '/orders/new',
    name: 'order-new',
    component: () => import('@/views/OrderEntryView.vue'),
    meta: { title: '新規注文' },
  },
  {
    path: '/orders/inquiry',
    name: 'order-inquiry',
    component: () => import('@/views/OrderInquiryListView.vue'),
    meta: { title: '注文照会' },
  },
  {
    path: '/masters/customers',
    name: 'customer-list',
    component: () => import('@/views/CustomerListView.vue'),
    meta: { title: '顧客マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/permissions',
    name: 'permission-list',
    component: () => import('@/views/PermissionListView.vue'),
    meta: { title: '権限マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/market-holidays',
    name: 'market-holiday-list',
    component: () => import('@/views/MarketHolidayListView.vue'),
    meta: { title: '海外休場日マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/blackout-dates',
    name: 'blackout-date-list',
    component: () => import('@/views/BlackoutDateListView.vue'),
    meta: { title: '受注不可日マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/symbols',
    name: 'symbol-list',
    component: () => import('@/views/SymbolListView.vue'),
    meta: { title: '銘柄マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/ca',
    name: 'corporate-action-list',
    component: () => import('@/views/CorporateActionListView.vue'),
    meta: { title: 'CAマスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/fx',
    name: 'fx-rate-master',
    component: () => import('@/views/FxRateMasterView.vue'),
    meta: { title: '為替マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/hard-limits',
    name: 'slice-criteria-master',
    component: () => import('@/views/SliceCriteriaMasterView.vue'),
    meta: { title: 'スライス基準マスタ', requiredPermission: 'master' },
  },
  {
    path: '/masters/balance-adjustments',
    name: 'balance-adjustment-list',
    component: () => import('@/views/BalanceAdjustmentListView.vue'),
    meta: { title: '残高マスタ', requiredPermission: 'master' },
  },
  {
    // モックは /executions/ だが、ルートは末尾スラッシュ無しで統一する（navigation.js と同じ）
    path: '/executions',
    name: 'execution-list',
    component: () => import('@/views/ExecutionListView.vue'),
    meta: { title: '約定照会' },
  },
  {
    path: '/orders/dream-status',
    name: 'dream-status-list',
    component: () => import('@/views/DreamStatusListView.vue'),
    meta: { title: 'Dream登録状況' },
  },
  {
    path: '/operations/announcements',
    name: 'announcement-management',
    component: () => import('@/views/AnnouncementsView.vue'),
    meta: { title: 'お知らせ管理', requiredPermission: 'operation' },
  },
  {
    path: '/operations/stalled-orders',
    name: 'stalled-order-list',
    component: () => import('@/views/StalledOrderListView.vue'),
    meta: { title: '滞留注文抽出', requiredPermission: 'operation' },
  },
  {
    path: '/operations/activity-logs',
    name: 'activity-log-list',
    component: () => import('@/views/ActivityLogListView.vue'),
    meta: { title: '操作ログ', requiredPermission: 'operation' },
  },
  {
    // 公開モックのパスどおり。約定照会（/executions）の配下に置かれている
    path: '/executions/mizuho-operations',
    name: 'mizuho-operations',
    component: () => import('@/views/MizuhoOperationsView.vue'),
    meta: { title: 'みずほ注文締' },
  },
  {
    path: '/operations/incidents',
    name: 'incident-management',
    component: () => import('@/views/IncidentManagementView.vue'),
    meta: { title: '障害管理', requiredPermission: 'operation' },
  },
  {
    // permissionGuard の行き先。サイドメニューには載せない
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

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(permissionGuard)

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | US Stock Order` : 'US Stock Order'
})

// ルート定義の検査（/masters/* の requiredPermission の付け忘れ）に使う
export { routes }
export default router

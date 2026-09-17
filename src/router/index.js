import { createRouter, createWebHistory } from 'vue-router'
import OrderListView from '@/views/OrderListView.vue'

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
    meta: { title: '顧客マスタ' },
  },
  {
    path: '/masters/permissions',
    name: 'permission-list',
    component: () => import('@/views/PermissionListView.vue'),
    meta: { title: '権限マスタ' },
  },
  {
    path: '/masters/market-holidays',
    name: 'market-holiday-list',
    component: () => import('@/views/MarketHolidayListView.vue'),
    meta: { title: '海外休場日マスタ' },
  },
  {
    path: '/masters/blackout-dates',
    name: 'blackout-date-list',
    component: () => import('@/views/BlackoutDateListView.vue'),
    meta: { title: '受注不可日マスタ' },
  },
  {
    path: '/masters/symbols',
    name: 'symbol-list',
    component: () => import('@/views/SymbolListView.vue'),
    meta: { title: '銘柄マスタ' },
  },
  {
    path: '/masters/ca',
    name: 'corporate-action-list',
    component: () => import('@/views/CorporateActionListView.vue'),
    meta: { title: 'CAマスタ' },
  },
  {
    path: '/masters/hard-limits',
    name: 'hard-limit-master',
    component: () => import('@/views/HardLimitMasterView.vue'),
    meta: { title: 'ハードリミットマスタ' },
  },
  {
    path: '/operations/activity-logs',
    name: 'activity-log-list',
    component: () => import('@/views/ActivityLogListView.vue'),
    meta: { title: '操作ログ' },
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

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | US Stock Order` : 'US Stock Order'
})

export default router

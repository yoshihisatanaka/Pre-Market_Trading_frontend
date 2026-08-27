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

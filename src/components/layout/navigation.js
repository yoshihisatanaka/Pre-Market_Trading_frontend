/**
 * サイドメニューの項目定義。
 * 並び・ラベル・パスは Manus モック（docs/mock/layout/masters-users.html）のサイドバーに準拠する。
 * ただし原本の取り込みが古く、公開モックのサイドバーにだけある項目がいくつかある
 * （顧客マスタ / スライス基準マスタ）。その場合は公開モックの並びに合わせて足す。
 * 画面を実装したら router/index.js に同じ path のルートを足す。
 * 未実装の path は NotFoundView に落ちる。
 * モックの項目にはアイコンが付いているが、項目はラベルだけで出す（アイコンは不要になった。2026-10-02）。
 *
 * 区分に requiredPermission（GET /auth/me の権限のキー）を付けると、その権限の無い利用者には
 * 区分ごと出さない（AppSidebar）。付けたら router/index.js の各ルートの meta.requiredPermission にも
 * 同じ値を付ける（メニューを隠すだけでは URL を直接開けば入れてしまう）。
 *
 * 区分はアコーディオンで開閉する。defaultOpen: false を付けた区分は畳んだ状態で始まる（省略時は開）。
 * ただし現在のページを含む区分は、既定に関わらず開く（AppSidebar）。
 */
export const navSections = [
  {
    label: '顧客',
    items: [
      { label: '顧客検索', to: '/customers/search' },
      { label: '預り検索', to: '/customers/holdings' },
    ],
  },
  {
    label: '注文・照会',
    // 新規注文（/orders/new）はモックどおりサイドメニューに置かない。注文照会などの画面内から遷移する
    items: [
      { label: 'CSV一括注文', to: '/orders/csv/upload' },
      { label: '注文照会', to: '/orders/inquiry' },
      { label: 'Dream登録状況', to: '/orders/dream-status' },
      // モックは /executions/ だが、ルートは末尾スラッシュ無しで統一する
      { label: '約定照会', to: '/executions' },
      // 公開モックでは約定照会の直後
      { label: 'みずほ注文締', to: '/executions/mizuho-operations' },
    ],
  },
  {
    label: 'マスタメンテ',
    // マスタ更新権限が無い操作者には全項目を出さない（2026-09-28 決定）
    requiredPermission: 'master',
    defaultOpen: false,
    items: [
      { label: '顧客マスタ', to: '/masters/customers' },
      { label: '権限マスタ', to: '/masters/permissions' },
      { label: '銘柄マスタ', to: '/masters/symbols' },
      { label: '為替マスタ', to: '/masters/fx' },
      // 公開モックで 2026-09-29 に追加（b9d023e）。並びは公開モックのサイドバーどおり為替マスタの直後
      { label: '仮計算マスタ', to: '/masters/provisional-calculation' },
      // docs/mock/layout/ の原本には無いが、公開モックのサイドバーには
      // /masters/hard-limits がこの位置にある（原本の取り込みが古い）
      { label: 'スライス基準マスタ', to: '/masters/hard-limits' },
      { label: 'CAマスタ', to: '/masters/ca' },
      { label: '受注不可日マスタ', to: '/masters/blackout-dates' },
      { label: '海外休場日マスタ', to: '/masters/market-holidays' },
      { label: '残高マスタ', to: '/masters/balance-adjustments' },
    ],
  },
  {
    /*
     * 公開モックの区分「運用管理」には お知らせ管理 / 滞留注文抽出 / 操作ログ / 障害管理 の
     * 4 項目がある。並びは公開モックに合わせる。
     * 運用管理権限の無い利用者（IFA / 営業員）には区分ごと出さない。
     */
    label: '運用管理',
    requiredPermission: 'operation',
    defaultOpen: false,
    items: [
      { label: 'お知らせ管理', to: '/operations/announcements' },
      { label: '滞留注文抽出', to: '/operations/stalled-orders' },
      { label: '操作ログ', to: '/operations/activity-logs' },
      { label: '障害管理', to: '/operations/incidents' },
    ],
  },
]

/** セクションを畳んだ全項目。テストや検索で使う */
export const navItems = navSections.flatMap((section) => section.items)

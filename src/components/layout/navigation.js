/**
 * サイドメニューの項目定義。
 * 並び・ラベル・パスは Manus モック（docs/mock/layout/masters-users.html）のサイドバーに準拠する。
 * 画面を実装したら router/index.js に同じ path のルートを足す（ここは変更しない）。
 * 未実装の path は NotFoundView に落ちる。
 */
export const navSections = [
  {
    label: '顧客',
    items: [
      { label: '顧客検索', to: '/customers/search', icon: 'search' },
      { label: '預り検索', to: '/customers/holdings', icon: 'cube' },
    ],
  },
  {
    label: '注文',
    items: [
      { label: '新規注文', to: '/orders/new', icon: 'plus' },
      { label: 'CSV一括注文', to: '/orders/csv/upload', icon: 'documentChart' },
      { label: '注文照会', to: '/orders/inquiry', icon: 'clipboard' },
      { label: 'Dream登録状況', to: '/orders/dream-status' },
      // モックは /executions/ だが、ルートは末尾スラッシュ無しで統一する
      { label: '約定照会', to: '/executions', icon: 'chartBar' },
    ],
  },
  {
    label: 'マスタメンテ',
    items: [
      { label: 'ユーザマスタ', to: '/masters/users' },
      { label: '銘柄マスタ', to: '/masters/symbols' },
      { label: '為替マスタ', to: '/masters/fx' },
      { label: 'CAマスタ', to: '/masters/ca' },
      { label: '受注不可日マスタ', to: '/masters/blocked-dates' },
      { label: '海外休場日マスタ', to: '/masters/market-holidays' },
      { label: '残高補正', to: '/masters/balance-adjustments' },
    ],
  },
]

/** セクションを畳んだ全項目。テストや検索で使う */
export const navItems = navSections.flatMap((section) => section.items)

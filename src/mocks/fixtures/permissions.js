/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 *
 * ただし他のフィクスチャと違い、**これは実 API の形ではない**。
 * docs/api/openapi.json に権限・ロールを扱うパスは 1 本も無い。
 *
 * 画面モック（https://uspreorder-vmbhej3k.manus.space/masters/permissions）が編集モーダルへ
 * 渡している JSON をそのまま写した**暫定の契約**なので、キーは他のマスタのような日本語では
 * なく snake_case になっている。実 API が出てきたら、この形と src/api/permissions.js の変換を
 * 仕様側と決め直す。
 *
 * 4 ロールしか無いのでページャーの確認用に件数を盛る必要は無い（一覧はページャーを持たない）。
 * 権限が全て true なのもモックのとおりで、モック自身の注記が
 * 「画面確認期間中は全操作を許可」と説明している。不許可のバッジを目で見たいときは、
 * どれかを false にして dev サーバを開くのが手早い。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

/** ロール別の権限。並びはモックの一覧と同じ */
export const rolePermissions = [
  {
    role: 'ifa',
    role_label: 'IFA',
    description: '画面確認期間中は全操作を許可',
    can_order: true,
    can_master_update: true,
    can_order_stop: true,
    can_activity_log_view: true,
    can_admin_function: true,
  },
  {
    role: 'sales',
    role_label: '営業員',
    description: '画面確認期間中は全操作を許可',
    can_order: true,
    can_master_update: true,
    can_order_stop: true,
    can_activity_log_view: true,
    can_admin_function: true,
  },
  {
    role: 'manager',
    role_label: '管理者',
    description: '画面確認期間中は全操作を許可',
    can_order: true,
    can_master_update: true,
    can_order_stop: true,
    can_activity_log_view: true,
    can_admin_function: true,
  },
  {
    role: 'supervisor',
    role_label: '管理責任者',
    description: '画面確認期間中は全操作を許可',
    can_order: true,
    can_master_update: true,
    can_order_stop: true,
    can_activity_log_view: true,
    can_admin_function: true,
  },
]

/**
 * いまの利用者が権限マスタを変更できるか。
 *
 * モックは `?as_user=` で操作者を切り替えられ、管理責任者のときだけ編集できる。
 * こちらには認証もログインロールもまだ無いので、管理責任者で入っている想定の固定値にする。
 * **「閲覧のみ」の見た目を確かめたいときはここを false にする**（操作列と編集ボタンが消え、
 * 画面上部の注記の見出しが変わる）。
 */
export const permissionsEditable = true

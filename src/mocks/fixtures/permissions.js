/*
 * モックのレスポンス実体。
 * ここに書くのは「バックエンドが返す生の形」であり、アプリ内モデルではない。
 *
 * GET /masters/permissions の roles[] の 1 件（openapi.json の RolePermissionItem）。
 * キーは日本語、権限は 0 / 1。`権限` は同じ内容の英語キーの真偽値（PermissionFlags）で、
 * サーバが 4 権限から導く値なので、ここでも 4 権限と食い違わないように書く。
 *
 * 値はバックエンドの初期データ（../Pre-Market_Trading の db/schema.sql の m_ロール権限）に揃える
 * （2026-09-29 に実 DB の値と突き合わせ、営業員の全店参照権限を 1 に直した）。
 * IFA は全部不可、営業員は発注と全店参照だけ、管理者・管理責任者は全部許可なので、
 * 許可 / 不可のバッジが両方とも目で見える。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

/**
 * 4 権限から `権限`（PermissionFlags）を導いて行に載せる（サーバと同じ対応）。
 * ハンドラが更新後の行を組み直すときにも使う。
 *
 * @param {object} row RolePermissionItem の生の形（`権限` 以外）
 * @returns {object} `権限` を 4 権限と揃えた行
 */
export function withPermissionFlags(row) {
  return {
    ...row,
    権限: {
      order: row.発注権限 === 1,
      master: row.マスタ更新権限 === 1,
      operation: row.運用管理権限 === 1,
      branch_all: row.全店参照権限 === 1,
    },
  }
}

/** ロール別の権限。並びは実 API と同じ ID 順（ifa → sales → manager → supervisor） */
export const rolePermissions = [
  withPermissionFlags({
    ID: 1,
    ロールコード: 'ifa',
    ロール名: 'IFA',
    説明: 'IFAユーザー。PH1〜PH2 は参照・仮計算のみ',
    発注権限: 0,
    マスタ更新権限: 0,
    運用管理権限: 0,
    全店参照権限: 0,
    ユーザー操作フラグ: 0,
    更新日時: '2026-09-18 10:00:00',
    更新者: 'BATCH',
  }),
  withPermissionFlags({
    ID: 2,
    ロールコード: 'sales',
    ロール名: '営業員',
    説明: '本部・支店の営業員。発注・取消が可能',
    発注権限: 1,
    マスタ更新権限: 0,
    運用管理権限: 0,
    全店参照権限: 1,
    ユーザー操作フラグ: 0,
    更新日時: '2026-09-18 10:00:00',
    更新者: 'BATCH',
  }),
  withPermissionFlags({
    ID: 3,
    ロールコード: 'manager',
    ロール名: '管理者',
    説明: '本部管理者。発注・マスタ更新・運用管理が可能',
    発注権限: 1,
    マスタ更新権限: 1,
    運用管理権限: 1,
    全店参照権限: 1,
    ユーザー操作フラグ: 0,
    更新日時: '2026-09-18 10:00:00',
    更新者: 'BATCH',
  }),
  withPermissionFlags({
    ID: 4,
    ロールコード: 'supervisor',
    ロール名: '管理責任者',
    説明: '全権限。権限マスタの変更は管理責任者のみ',
    発注権限: 1,
    マスタ更新権限: 1,
    運用管理権限: 1,
    全店参照権限: 1,
    ユーザー操作フラグ: 0,
    // 一度も画面から更新されていない行（合札が無い）。更新日時 を送らない経路の確認用
    更新日時: null,
    更新者: null,
  }),
]

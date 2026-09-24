import { http, HttpResponse } from 'msw'
import { permissionsEditable, rolePermissions } from '../fixtures/permissions'

export const permissionHandlers = [
  /*
   * 権限マスタ（ロール別権限）の一覧。
   *
   * **実 API にこのエンドポイントは無い。** openapi.json に権限・ロールを扱うパスは
   * 1 本も無く、ここは画面モックの見た目を出すための暫定。実 API が繋がったら
   * このハンドラを消し、src/api/permissions.js の変換と画面の列を仕様側と決め直す。
   *
   * editable は「いまの利用者が権限を変更できるか」。モックは ?as_user= で操作者を
   * 切り替えて判定するが、こちらには認証がまだ無いので固定値を返す。
   *
   * 書き換える操作が無いので可変状態は持たない（resetMockState の対象外）。
   */
  http.get('*/api/masters/permissions', () => {
    return HttpResponse.json({
      roles: rolePermissions,
      editable: permissionsEditable,
    })
  }),
]

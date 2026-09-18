# stores/〈name〉（〈画面名〉のストア・雛形）

- 略号: `XXS`
- 対象: `src/stores/〈name〉.js`
- テスト: `src/stores/〈name〉.spec.js`

> **これは雛形。** コピーして `XXS` / `〈…〉` を差し替え、固有の行を足す。原型は `stores-symbols.md`。
> `useCrudList` に任せている振る舞い（古い応答の破棄・登録後の再取得）は `composables-use-crud-list.md` が守るので、
> ここでは**このストア固有の入出力**だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/〈name〉.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| XXS-01 | 既定モック | `load()` を呼ぶ | `items` がフィクスチャの有効行の 1 ページぶん、`total` が有効行の件数になる（取消済みは含まない） | 未着手 |
| XXS-02 | 既定モック | `load({ offset: PAGE_SIZE })` | 2 ページ目の行が入る | 未着手 |
| XXS-03 | 既定モック | `load({ 〈filter〉: 値 })` | その条件に合う行だけになる（件数はフィクスチャから導く） | 未着手 |
| XXS-04 | `GET /xxx` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 未着手 |
| XXS-05 | 0 件の応答 | `load()` | `isEmpty` が true | 未着手 |
| XXS-06 | 既定モック（CRUD のみ） | `create(入力)` | 応答の 1 件が camelCase で返り、`total` が 1 増える | 未着手 |
| XXS-07 | 事前検証が不合格（CRUD のみ） | `create(入力)` | `validationErrors` に理由が入り、登録は呼ばれない（件数が増えない） | 未着手 |
| XXS-08 | 更新 API が 409（CRUD のみ） | `update(入力)` | `updateError.message` に detail が入り、`items` は変わらない | 未着手 |
| XXS-09 | 既定モック（CRUD のみ） | `remove(id)` | その行が `items` から消え、`total` が 1 減る | 未着手 |

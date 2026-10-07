# stores/feePreferences（手数料優遇マスタのストア）

- 略号: `FPS`
- 対象: `src/stores/feePreferences.js`
- テスト: `src/stores/feePreferences.spec.js`

`useCrudList` に任せている振る舞い（古い応答の破棄・登録後の再取得）は `composables-use-crud-list.md` が守るので、
ここでは**このストア固有の入出力**だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/feePreferences.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。`beforeEach(() => setActivePinia(createPinia()))`。

事前検証の警告（手数料パターンマスタに無いパターン・方式で使われない項目）は**登録側だけ**が
`validationWarnings` で止まり、`acknowledgedWarnings: true` で押し直すと登録に進む（FPS-10）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FPS-01 | 既定モック | `load()` を呼ぶ | `items` がフィクスチャの有効行の 1 ページぶん（50 件）、`total` が有効行の件数（52）になる（取消済みは含まない） | 実装済 |
| FPS-02 | 既定モック | `load({ offset: FEE_PREFERENCES_PAGE_SIZE })` | 2 ページ目の行（2 件）が入る | 実装済 |
| FPS-03 | 既定モック | `load({ branchCode: '234' })` | その部店の行だけになる（件数はフィクスチャから導く） | 実装済 |
| FPS-04 | `GET /masters/fee-preferences` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 実装済 |
| FPS-05 | 0 件の応答 | `load()` | `isEmpty` が true | 実装済 |
| FPS-06 | 既定モック | `create({ accountNumber: '1230014', fxSpread: '0' })` | 応答の 1 件が camelCase で返り、`total` が 1 増える | 実装済 |
| FPS-07 | 既定モック（既に登録のある口座） | `create({ accountNumber: '1230001' })` | `validationErrors` に重複の理由が入り、登録は呼ばれない（件数が増えない） | 実装済 |
| FPS-08 | 更新 API が 409 | `update(入力)` | `updateError.message` に detail が入り、`items` は変わらない | 実装済 |
| FPS-09 | 既定モック | `remove(id)` | その行が `items` から消え、`total` が 1 減る | 実装済 |
| FPS-10 | 既定モック | `create({ accountNumber: '2340014', feePattern: 'E' })` → 続けて同じ入力に `acknowledgedWarnings: true` を足して `create` | 1 回目は null が返り `validationWarnings` に警告が入って件数は増えない。2 回目は登録され、`validationWarnings` が空になり件数が 1 増える | 実装済 |

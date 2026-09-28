# stores/mizuhoClosing（みずほ注文締の締め状態のストア）

- 略号: `MCS`
- 対象: `src/stores/mizuhoClosing.js`
- テスト: `src/stores/mizuhoClosing.spec.js`

締め状態の照会だけを持つ（締め実行・締め解除は処理を繋ぐ段で足す）。
MSW の既定ハンドラ（`src/mocks/handlers/closing.js`）に当てる。`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MCS-01 | 既定モック | `load()` を呼ぶ | `status.closed` が false、`isEmpty` が false、`loading` は false に戻る | 実装済 |
| MCS-02 | 応答の本文が空 | `load()` | `status` が null、`isEmpty` が true | 実装済 |
| MCS-03 | `GET /closing/status` が 500 | `load()` | `error.message` に理由が入り、`isEmpty` は false（エラーは空ではない） | 実装済 |
| MCS-04 | 応答を握ったまま | `load()` を呼ぶ | `loading` が true、`isEmpty` は false | 実装済 |

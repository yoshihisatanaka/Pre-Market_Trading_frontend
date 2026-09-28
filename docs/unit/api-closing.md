# api/closing（締め管理 API 層）

- 略号: `CLS`
- 対象: `src/api/closing.js`
- テスト: `src/api/closing.spec.js`

`GET /closing/status` の照会だけを持つ（締め実行・締め解除は処理を繋ぐ段で足す）。
パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が見るので、ここでは**この層の変換**だけを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CLS-01 | 既定モック | `fetchMizuhoClosingStatus()` | `closing_type=MIZUHO` を付けて問い合わせ、`{ closed: false, updatedAt: null, operator: '' }` を返す | 実装済 |
| CLS-02 | 応答が締め済（`closedMizuhoClosingStatus`） | `fetchMizuhoClosingStatus()` | `closed` が true、`updatedAt` が 更新日時 のまま、`operator` が 実行者 になる | 実装済 |
| CLS-03 | 応答の本文が空 | `fetchMizuhoClosingStatus()` | `null` を返す（画面はこれを「空」として出す） | 実装済 |
| CLS-04 | `GET /closing/status` が 500 | `fetchMizuhoClosingStatus()` | `ApiError` で reject する | 実装済 |

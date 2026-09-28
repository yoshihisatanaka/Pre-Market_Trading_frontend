# components/operations/ConfirmationImportErrors（取込の行エラーの表）

- 略号: `CIE`
- 対象: `src/components/operations/ConfirmationImportErrors.vue`
- テスト: `src/components/operations/ConfirmationImportErrors.spec.js`

コンファメーション CSV の取込で返った行エラー（`ConfirmationImportResult.errors`）を表にする。
props → 描画だけを見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CIE-01 | 行エラー 1 件 | マウントする | 列見出しが 行 / 注文ID / 内容 | 実装済 |
| CIE-02 | 行エラー 2 件 | マウントする | 2 行が出て、行番号と注文 ID がそのまま出る | 実装済 |
| CIE-03 | 1 行に理由が 2 つ | マウントする | 内容のセルに 2 つとも出る | 実装済 |
| CIE-04 | `orderId` が空文字 | マウントする | 注文ID のセルが「—」 | 実装済 |
| CIE-05 | `lineNumber` が null | マウントする | 行のセルが「—」 | 実装済 |

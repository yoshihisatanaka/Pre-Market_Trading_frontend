# components/ui/FileDropZone（ファイル選択領域）

- 略号: `FDZ`
- 対象: `frontend/src/components/ui/FileDropZone.vue`
- テスト: `frontend/src/components/ui/FileDropZone.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FDZ-01 | 未選択（`v-model` が `null`） | マウントする | 案内文（`label`）が表示される | 実装済 |
| FDZ-02 | `v-model` に File を渡す | マウントする | 案内文の代わりにファイル名が表示される | 実装済 |
| FDZ-03 | 未選択 | ファイルをドロップする | `update:modelValue` がその File で発火する | 実装済 |
| FDZ-04 | 未選択 | 領域の上にドラッグする | `data-dragover` が `true` になる | 実装済 |
| FDZ-05 | ドラッグ中 | 領域から離れる | `data-dragover` が `false` に戻る | 実装済 |
| FDZ-06 | `accept=".csv"` を渡す | マウントする | ファイル入力の `accept` が `.csv` になる | 実装済 |
| FDZ-07 | `hint` を渡す | マウントする | 補助文が表示される | 実装済 |

# utils/download（ファイルのダウンロード）

- 略号: `DLU`
- 対象: `src/utils/download.js`
- テスト: `src/utils/download.spec.js`

`downloadBlob(filename, blob)`（サーバが返したファイル）と `downloadCsv(filename, text)`（手元で組み立てた CSV）は、
どちらも DOM の副作用だけの関数。`downloadCsv` は本文を Blob にして `downloadBlob` に渡す。
jsdom は `URL.createObjectURL` / `revokeObjectURL` を持たないのでテストの間だけ生やし、`<a>` の click は
spy に差し替えて click された瞬間の要素の様子を記録する（jsdom は遷移を実装していない）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| DLU-01 | — | `downloadCsv(ファイル名, 本文)` を呼ぶ | `download` 属性にファイル名、`href` にオブジェクト URL を持つ `<a>` が、文書に置かれた状態で 1 回 click される | 実装済 |
| DLU-02 | — | `downloadCsv` を呼ぶ | オブジェクト URL の元の Blob は type が `text/csv;charset=utf-8` で、中身が渡した本文そのもの | 実装済 |
| DLU-03 | — | `downloadCsv` を呼ぶ | 呼び終えたあと `<a>` は文書から外れている | 実装済 |
| DLU-04 | fake timers | `downloadCsv` を呼ぶ | その場では `revokeObjectURL` が呼ばれず、次のタスクでそのオブジェクト URL が破棄される | 実装済 |
| DLU-05 | — | `downloadBlob(ファイル名, Blob)` を呼ぶ | 渡した Blob そのもの（作り直さない）からオブジェクト URL を作り、`download` 属性にファイル名を持つ `<a>` が 1 回 click される。呼び終えたあと `<a>` は文書から外れ、次のタスクで URL が破棄される | 実装済 |

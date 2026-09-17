# api/sliceCriteria（スライス基準マスタ API 層）

- 略号: `SCA`
- 対象: `src/api/sliceCriteria.js`
- テスト: `src/api/sliceCriteria.spec.js`

ここだけが**バックエンドの形**（`/masters/hard-limits` というパス・日本語キー・`スライス有効フラグ` の
0/1）を知ってよい層なので、この文書は「**実際に送り出す HTTP リクエストの形**」と
「受け取った生データの変換」を守る。

ストア（[stores-slice-criteria.md](stores-slice-criteria.md)）と画面
（[views-slice-criteria-master-view.md](views-slice-criteria-master-view.md)）のテストは、MSW のモックが
返す結果を見ている。モックはこちらの実装と同じ理解で書かれているので、**モックとサーバの理解が
ずれていても気づけない**。実際、`備考` を送らずに更新すると実 API は備考を NULL に落とすが
（2026-09-11 に実測）、この層が現在値を送り返すまでモックでは再現していなかった。
そこでこの文書では、モックの応答ではなく**送信されたリクエストそのもの**を
`docs/api/openapi.json` の `SliceSettingUpdateRequest` と突き合わせる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SCA-01 | 既定モック | `fetchSliceCriteria()` を呼ぶ | `GET /api/masters/hard-limits` を呼ぶ。クエリは付けない（単一リソースなので絞り込みが無い） | 実装済 |
| SCA-02 | API が `SliceSettingResponse` を返す | `fetchSliceCriteria()` を呼ぶ | 日本語キーが camelCase に変換される。`スライス有効フラグ: 1` は `sliceEnabled: true` になる | 実装済 |
| SCA-03 | API が `スライス有効フラグ: 0` を返す | `fetchSliceCriteria()` を呼ぶ | `sliceEnabled` が `false` になる | 実装済 |
| SCA-04 | API が `備考: null` を返す | `fetchSliceCriteria()` を呼ぶ | `note` が `null` のまま返る（空文字に丸めない。更新時にそのまま送り返すため） | 実装済 |
| SCA-05 | API が本文なし（204）を返す | `fetchSliceCriteria()` を呼ぶ | `null` を返す。例外にはしない | 実装済 |
| SCA-06 | 既定モック | `updateSliceCriteria()` を呼ぶ | `PUT /api/masters/hard-limits` の本文が日本語キー 6 項目（`市場関与率` / `大口数量閾値` / `大口金額閾値` / `スライス有効フラグ` / `備考` / `更新日時`）になる | 実装済 |
| SCA-07 | `sliceEnabled: false` を渡す | `updateSliceCriteria()` を呼ぶ | `スライス有効フラグ` が boolean ではなく integer の `0` で載る | 実装済 |
| SCA-08 | `note` に文字列を渡す | `updateSliceCriteria()` を呼ぶ | `備考` にその文字列が載る（省略すると実 API が NULL に落とすため、必ず送る） | 実装済 |
| SCA-09 | `VITE_USER_CODE` が設定されている | `updateSliceCriteria()` を呼ぶ | リクエストに `X-User-Code` ヘッダが載る（実 API が操作者コードを見るため） | 実装済 |
| SCA-10 | API が 422（`detail` が 2 件）を返す | `updateSliceCriteria()` を呼ぶ | `ApiError` の `status` が 422 になり、`message` に 2 件ぶんが項目名付きで ` / ` 連結で入る | 実装済 |

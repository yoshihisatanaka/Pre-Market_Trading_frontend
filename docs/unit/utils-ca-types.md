# utils/caTypes（CA種別）

- 略号: `CAT`
- 対象: `src/utils/caTypes.js`
- テスト: `src/utils/caTypes.spec.js`

CA種別コードと表示名の対応表。検索セレクトの選択肢と一覧セルの表示名で共用する。

**表示名は `docs/api/openapi.json` に無い**（`CATypeEnum` は string の enum でコードだけ）。
名前はバックエンドの対応表（`app/config/codes.json` の「CA種別」）から写したものなので、
コードの集合が enum と一致していることをここで固定する（enum だけ増えても名前は出ない）。

海外休場区分の同種の文書は [utils-market-holiday-types.md](utils-market-holiday-types.md)。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CAT-01 | — | `CA_TYPE_OPTIONS` を読む | `docs/api/openapi.json` の `CATypeEnum` と同じ 12 個のコードを、コードの昇順で持つ。各要素は `{ value, label }` で label は空でない | 実装済 |
| CAT-02 | — | `formatCaType('120')` を呼ぶ | `'株式分割'` が返る | 実装済 |
| CAT-03 | — | `formatCaType()` を未知のコード・空文字・未設定で呼ぶ | いずれも `'—'` が返る（他の列の空値表現とそろえる） | 実装済 |
| CAT-04 | — | `isCaType()` を既知のコードと未知の値で呼ぶ | 既知なら `true`、未知・空文字・数値・未設定なら `false` | 実装済 |

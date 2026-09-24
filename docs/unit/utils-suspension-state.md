# utils/suspensionState（発注停止の総合状態）

- 略号: `SUS`
- 対象: `src/utils/suspensionState.js`
- テスト: `src/utils/suspensionState.spec.js`
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

サーバは 発注停止中 / 全体停止中 / 停止中の対象 のフラグだけを返し、総合の表示名を返さない。
画面の「現在の運用状態」の文言は `summarizeSuspension()` だけが合成する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SUS-01 | `status` が null | `summarizeSuspension(null)` | `null` が返る | 実装済 |
| SUS-02 | どの対象も停止していない | 呼ぶ | `{ label: '通常運用', tone: 'normal' }` | 実装済 |
| SUS-03 | `allSuspended` が true（ルート行も一部停止中） | 呼ぶ | `{ label: '全体停止中', tone: 'danger' }`。ルート名は出さない | 実装済 |
| SUS-04 | `suspendedTargets` が `['2', '1']`（全体は通常） | 呼ぶ | `label` が「一部停止中（IB, VWAP）」。名前は `targets` の並び順で、`suspendedTargets` の順ではない。`tone` は `warning` | 実装済 |
| SUS-05 | `suspendedTargets` に `targets` に無いコード `'9'` がある | 呼ぶ | 既知の名前の後ろにコード `9` がそのまま出る | 実装済 |
| SUS-06 | `suspended` が true だが `suspendedTargets` が空 | 呼ぶ | `label` が「一部停止中」（括弧なし） | 実装済 |

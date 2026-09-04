# 単体テスト シナリオ

テスト対象ファイルごとの **守るべき振る舞い** を、単体テストを書く前に Markdown の表で書く場所。
E2E の [docs/e2e/](../e2e/README.md) と同じ仕組み・同じ表形式。違いは「画面単位」ではなく「ファイル単位」であること。

## ルール

### ファイル

- **1 テスト対象ファイル = 1 文書**。`docs/unit/<src からの相対パスをケバブケース化>.md`

  | 対象 | 文書 |
  |---|---|
  | `src/stores/orders.js` | `stores-orders.md` |
  | `src/components/ui/DataTable.vue` | `components-ui-data-table.md` |
  | `src/views/OrderListView.vue` | `views-order-list-view.md` |

- 冒頭で **略号** を宣言する。**3 文字**を推奨（E2E は 2 文字。衝突を避ける）

### シナリオ ID

- `<略号>-<2 桁連番>`（例: `OST-01`）。欠番になっても振り直さない
- ID は E2E / 単体を通して一意（チェックが検出する）

### 表の列（E2E と同じ）

| 列 | 単体テストでの意味 |
|---|---|
| ID | 上記 |
| 前提 | 入力値・props・モック応答（`既定モック` / `API が 500` など） |
| 操作 | 呼び出し・マウント・イベント（`load() を呼ぶ` / `再読み込みボタンを click` など） |
| 期待結果 | **外から観察できる結果**（戻り値・状態・描画内容）。内部変数名や呼び出し回数は書かない |
| 状態 | `実装済` / `未着手` / `保留` |

### 粒度の指針

- **1 行 = 1 つの観察可能な振る舞い**。「成功時」「エラー時」「空のとき」のように分ける
- 実装をなぞらない。「`toOrder()` が呼ばれる」ではなく「`ordered_at` が `orderedAt` になる」と書く
- 同じ振る舞いを E2E とも検証する場合は両方に書いてよい（ID は別）

### テストコード側

- `it('[OST-01] …')` / `test('[OST-01] …')` のように **タイトル先頭に ID**。1 テスト = 1 ID
- 文書に無い ID は付けない（文書が正）
- ID の無いテストは warning として件数が出る（新規テストには必ず付ける）

## 対応チェック

```powershell
docker compose run --rm frontend npm run check:scenarios
```

E2E と単体の両方を検査する。

## テストを追加するときの流れ

1. `docs/unit/<対象>.md` に行を足す（`未着手`）
2. Claude に「`docs/unit/<対象>.md` の OST-xx を実装して」と依頼する
3. テストが通ったら `実装済` に変える
4. `check:scenarios` を通してコミット

## 見本

- [stores-orders.md](stores-orders.md) ↔ `src/stores/orders.spec.js`（ストア）
- [components-ui-data-table.md](components-ui-data-table.md) ↔ `src/components/ui/DataTable.spec.js`（汎用部品）
- [views-order-list-view.md](views-order-list-view.md) ↔ `src/views/OrderListView.spec.js`（画面）

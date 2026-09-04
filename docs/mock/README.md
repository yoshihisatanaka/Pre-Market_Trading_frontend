# 画面モック（Manus）

## 置き方

Manus が出力した HTML / CSS / 画像を、**無加工のまま**このディレクトリに置く。
画面ごとにサブディレクトリを切ると参照しやすい。

```
docs/mock/
├─ order-list/
│  ├─ index.html
│  └─ style.css
└─ order-entry/
   └─ ...
```

## Vue コンポーネント化の手順

1. 原本をここに置く（**編集しない**。差分の参照元として残す）
2. CSS の中から色・余白・フォントサイズを [src/assets/styles/tokens.css](../../src/assets/styles/tokens.css) の CSS 変数へ吸い上げる
3. HTML を `views/` の画面 + `components/` の部品に分解する
4. 各コンポーネントの `<style scoped>` に、対応する CSS を移す（直値ではなくトークンを参照する形に書き換える）

## 現状

- 公開 URL（`https://uspreorder-vmbhej3k.manus.space/`）で受領。**素の CSS**（Tailwind ではない）
- 共通レイアウト部分を `layout/masters-users.html` に保存済み。CSS はこの 1 ファイルにインラインで入っている
  （どの画面を保存しても共通部分の CSS は同一。`.sidebar-*` / `.topbar-*` / `.btn` / `.card` / `.badge` などの原本）
- 配色・文字サイズは `tokens.css` へ吸い上げ済。サイドバーとヘッダは
  `src/components/layout/` にコンポーネント化済み
- 共通 UI 部品（入力・ラベル・カード・モーダル等）の抽出元として、以下 4 画面を保存済み

  | ディレクトリ | 元 URL | 備考 |
  |---|---|---|
  | `customers-holdings/index.html` | `/customers/holdings` | 検索前の状態（空の案内文） |
  | `customers-holdings/submitted.html` | `/customers/holdings?submitted=1` | 検索結果あり（sticky テーブル・損益2段表示） |
  | `orders-new/index.html` | `/orders/new` | `.fsk-*` 系。ラベル左寄せ・下線入力・セグメントトグル・買/売テーマ |
  | `orders-csv-upload/index.html` | `/orders/csv/upload` | `.upload-area`（ドラッグ&ドロップ）・`.csv-format-table` |
  | `masters-blocked-dates/index.html` | `/masters/blocked-dates` | 検索カード + 一覧 + 追加/削除モーダル |

- **フォーム様式は 2 系統ある。** `.field-label` + `.form-input`（枠線ボックス。holdings / blocked-dates /
  masters-users）と、`.fsk-label` + `.fsk-input`（下線。orders/new のみ）。
  `components/ui/` では前者を `variant="boxed"`、後者を `variant="underline"` として同じ部品で扱う
- 残りの個別画面はまだ取り込んでいない。着手時にこのディレクトリへ
  `docs/mock/<画面>/` として保存してから分解する

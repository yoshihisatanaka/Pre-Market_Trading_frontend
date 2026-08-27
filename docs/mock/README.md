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
2. CSS の中から色・余白・フォントサイズを [frontend/src/assets/styles/tokens.css](../../frontend/src/assets/styles/tokens.css) の CSS 変数へ吸い上げる
3. HTML を `views/` の画面 + `components/` の部品に分解する
4. 各コンポーネントの `<style scoped>` に、対応する CSS を移す（直値ではなくトークンを参照する形に書き換える）

## Tailwind ベースだった場合

CSS を移植する代わりに Tailwind を有効化し、モックのクラス属性をそのまま貼れる構成に切り替える。
手順は [docs/coding-standards.md「Tailwind を後から有効化する手順」](../coding-standards.md#tailwind-を後から有効化する手順) を参照。

## 現状

未受領。現在の画面は素の CSS + CSS 変数で暫定実装してある。

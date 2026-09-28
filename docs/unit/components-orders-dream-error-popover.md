# components/orders/DreamErrorPopover（Dream 連携エラーのポップアップ）

- 略号: `DEP`
- 対象: `src/components/orders/DreamErrorPopover.vue`
- テスト: `src/components/orders/DreamErrorPopover.spec.js`

状況の文字（既定スロット）にホバー / フォーカスしたときだけ、エラー内容を出す部品。
入出力は props（`title` / `message`）・既定スロット・開閉の操作だけに絞る。
本文は body へ Teleport するので、テストは `global: { stubs: { teleport: true } }` で wrapper 内に描かせる。

本文は閉じていても DOM に残る（`v-show`。トリガの `aria-describedby` の参照先を消さないため）ので、
「表示されているか」は本文の `display` で見る。位置は jsdom が寸法を持たないので、トリガの矩形と
本文の寸法をテストの中で与える。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| DEP-01 | `title` / `message` とスロットを渡す | マウントする | スロットの中身がトリガ内に出る。トリガはフォーカスでき（`tabindex="0"`）、`aria-describedby` が本文（`role="tooltip"`）の id を指す。本文は非表示 | 実装済 |
| DEP-02 | DEP-01 の状態 | トリガに `mouseenter` | 本文が表示され、見出しに `title`、本文に `message` が出る | 実装済 |
| DEP-03 | DEP-02 の状態 | トリガから `mouseleave` | 本文が非表示に戻る | 実装済 |
| DEP-04 | DEP-01 の状態 | トリガに `focus` → `blur` | フォーカスで表示され、外れると非表示に戻る | 実装済 |
| DEP-05 | フォーカスで開いた状態 | Esc キーを押す | 本文が非表示に戻る | 実装済 |
| DEP-06 | `message` が空 | 開く | 本文に「エラー内容を確認してください。」の定型文が出る | 実装済 |
| DEP-07 | 開いた状態 | 画面のどこかがスクロール / ウィンドウがリサイズされる | 本文が非表示に戻る（位置がずれたまま残さない） | 実装済 |
| DEP-08 | トリガの上に本文が入る余白がある | 開く | 本文がトリガの真上（間隔 8px）に置かれ、上向きの配置になる | 実装済 |
| DEP-09 | トリガの上に本文が入らない | 開く | 本文がトリガの真下（間隔 8px）に置かれ、下向きの配置になる | 実装済 |
| DEP-10 | トリガが画面の右端近くにある | 開く | 本文の左端が画面の内側（右端から 8px）へ押し戻される | 実装済 |

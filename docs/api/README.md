# API 仕様

## 置き方

| ファイル | 内容 |
|---|---|
| （このディレクトリ直下） | バックエンドから受領した仕様書の**原本**をそのまま置く（Excel / Markdown / PDF 等） |
| `openapi.yaml` | 原本を AI で変換した OpenAPI 3.1 仕様。**これを唯一の正とする** |

## 手順

1. バックエンド担当から仕様書を受領し、このディレクトリに原本を置く
2. Claude に変換を依頼し、`openapi.yaml` を生成する
3. 生成結果を原本と突き合わせて確認する（特に必須／任意、型、enum、日時フォーマット）
4. `openapi.yaml` の `example` を [frontend/src/mocks/fixtures/](../../frontend/src/mocks/fixtures/) に反映する
5. 未実装の API は MSW ハンドラを追加してフロント開発を進める

仕様の解釈で迷ったら `openapi.yaml` を見る。原本と食い違っていたらバックエンド担当に確認し、**両方を直す**。

## 現状

未受領。`openapi.yaml` はまだ存在しない。
それまでの間、フロントエンドは [frontend/src/mocks/](../../frontend/src/mocks/) の仮フィクスチャで開発を進める。

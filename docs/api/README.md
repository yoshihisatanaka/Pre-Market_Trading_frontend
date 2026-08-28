# API 仕様

## 置き方

| ファイル | 内容 |
|---|---|
| （このディレクトリ直下） | バックエンドから受領した仕様書の**原本**をそのまま置く（Excel / Markdown / PDF 等） |
| `openapi.yaml` | 原本を AI で変換した OpenAPI 3.1 仕様。**これを唯一の正とする** |

## 手順

詳細は [CONVERSION.md](CONVERSION.md)（`/api-to-openapi` スキルの使い方・チェックリスト・反映手順）を参照。

1. バックエンド担当から仕様書を受領し、このディレクトリに原本を置く
2. Claude Code で `/api-to-openapi docs/api/<原本>` を実行し、`openapi.yaml` を生成する
3. 報告されたチェックリスト結果を原本と突き合わせて再確認する
4. `openapi.yaml` の `example` を [frontend/src/mocks/fixtures/](../../frontend/src/mocks/fixtures/) に反映する
5. 未実装の API は MSW ハンドラを追加してフロント開発を進める

仕様の解釈で迷ったら `openapi.yaml` を見る。原本と食い違っていたらバックエンド担当に確認し、**両方を直す**。

## 現状

未受領。`openapi.yaml` はまだ存在しない。
それまでの間、フロントエンドは [frontend/src/mocks/](../../frontend/src/mocks/) の仮フィクスチャで開発を進める。

import { apiClient } from './client'
import { toFileDownload } from './fileDownload'

/*
 * みずほ連携（実 API `/mizuho/*`）。いまはオーダーシート（注文ファイル）の作成だけを持つ。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次の 3 点。
 *   - 応答は xlsx のバイト列。ファイル名は Content-Disposition の `filename*`（日本語名）
 *   - 件数は本文ではなくヘッダで返る（X-Exported-Count / X-Newly-Exported-Count /
 *     X-Skipped-Unregistered。どれも数字の文字列）
 *   - 売買区分はクエリ `side` で選び、1 回で 1 冊（買い / 売り）しか出ない
 *
 * 成熟度 C（パスとクエリは openapi.json にあるが、応答のスキーマ・400 の宣言・件数ヘッダは
 * 説明文にしか無い。形はバックエンドの実装 app/api/mizuho_api.py に合わせた）。
 *
 * **副作用がある。** シートに載せた未出力（000）の注文はサーバで 003（発注済）へ進み、
 * 以降は取消・訂正できない。作り直しは同じ内容を返し、状態は変えない。
 * みずほ注文締めの前は 400（「注文ファイルは、みずほ注文締め後に作成してください。」）。
 */

/**
 * @typedef {{
 *   blob: Blob,
 *   filename: string,
 *   exportedCount: number|null,
 *   newlyExportedCount: number|null,
 *   skippedCount: number|null,
 * }} MizuhoOrderSheet
 *   exportedCount はシートに載せた件数、newlyExportedCount はそのうち今回発注済へ進めた件数、
 *   skippedCount は Dream 未登録のため載せられなかった件数。ヘッダが読めなければ null
 */

/**
 * みずほのオーダーシート（1 冊）を作成する。対象日はサーバの基準日（target_date は送らない）。
 *
 * @param {{ side: 'buy'|'sell' }} params 売買区分のブック
 * @returns {Promise<MizuhoOrderSheet>}
 */
export async function exportMizuhoOrderSheet({ side }) {
  const response = await apiClient.get('/mizuho/export-orders', {
    params: { side },
    responseType: 'arraybuffer',
  })

  return {
    // ヘッダが読めないときの名前。実 API は オーダーシート_[yyyymmdd]_[BUY/SELL]_US.xlsx を付けてくる
    ...toFileDownload(response, `オーダーシート_${side.toUpperCase()}_US.xlsx`),
    exportedCount: toCount(response.headers?.['x-exported-count']),
    newlyExportedCount: toCount(response.headers?.['x-newly-exported-count']),
    skippedCount: toCount(response.headers?.['x-skipped-unregistered']),
  }
}

/** 件数ヘッダ（数字の文字列）→ 数値。欠けている・数でなければ null */
function toCount(value) {
  const count = Number.parseInt(value ?? '', 10)
  return Number.isInteger(count) && count >= 0 ? count : null
}

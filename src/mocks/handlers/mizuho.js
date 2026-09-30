import { http, HttpResponse } from 'msw'
import { mizuhoOrders } from '../fixtures/mizuhoOrders'
import { detailError } from './_shared'
import { currentMizuhoClosingStatus } from './closing'

/*
 * みずほ連携（/mizuho/*）。いまは注文ファイル（オーダーシート）の作成だけに応える。
 *
 * 実 API（app/api/mizuho_api.py）に合わせている点:
 *   - みずほ注文締めの前は 400（締め状態は handlers/closing.js の書き換え可能な状態を見る）
 *   - 1 回で 1 冊（side=buy / sell。既定は buy）。ファイル名は Content-Disposition の filename*
 *   - 件数は X-Exported-Count / X-Newly-Exported-Count / X-Skipped-Unregistered ヘッダで返す
 *   - 載せた未出力（000）の注文は 003 へ進める。作り直しは同じ件数で、今回進めた件数は 0 になる
 * 本文は Excel として開けないダミー（空の zip）。画面は中身を読まず、そのまま保存させるだけ。
 *
 * 注文の状態は書き換え可能なので、resetMizuhoOrderState() を handlers/index.js に登録してある。
 */

const NOT_CLOSED_DETAIL = '注文ファイルは、みずほ注文締め後に作成してください。'
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const cloneOrders = () => mizuhoOrders.map((row) => ({ ...row }))

let orderRows = cloneOrders()

export function resetMizuhoOrderState() {
  orderRows = cloneOrders()
}

/** 空の zip（End of Central Directory だけの 22 バイト）。xlsx は zip なので形だけ寄せる */
function placeholderWorkbook() {
  const bytes = new Uint8Array(22)
  bytes.set([0x50, 0x4b, 0x05, 0x06])
  return bytes
}

export const mizuhoHandlers = [
  http.get('*/api/mizuho/export-orders', ({ request }) => {
    const closing = currentMizuhoClosingStatus()
    if (closing.締め状態 !== 1) return detailError(400, NOT_CLOSED_DETAIL)

    // 実 API は sell / 1 を売り、それ以外（省略を含む）を買いとして扱う
    const side = new URL(request.url).searchParams.get('side') ?? 'buy'
    const isSell = ['sell', '1'].includes(side.toLowerCase())
    const sideCode = isSell ? '1' : '3'
    const sideLabel = isSell ? 'SELL' : 'BUY'

    const bookRows = orderRows.filter((row) => row.売買区分 === sideCode)
    const exported = bookRows.filter(
      (row) => row.Dream登録状況 === '2' && ['000', '003'].includes(row.処理状況),
    )
    const skipped = bookRows.filter((row) => row.Dream登録状況 !== '2' && row.処理状況 === '000')
    const newlyExported = exported.filter((row) => row.処理状況 === '000')
    for (const row of newlyExported) row.処理状況 = '003'

    const filename = `オーダーシート_${closing.基準日}_${sideLabel}_US.xlsx`

    return new HttpResponse(placeholderWorkbook(), {
      headers: {
        'Content-Type': XLSX_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Exported-Count': String(exported.length),
        'X-Newly-Exported-Count': String(newlyExported.length),
        'X-Skipped-Unregistered': String(skipped.length),
      },
    })
  }),
]

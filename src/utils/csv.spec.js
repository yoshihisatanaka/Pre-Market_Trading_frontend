import { describe, expect, it } from 'vitest'
import { buildCsv } from './csv'

const BOM = String.fromCharCode(0xfeff)
const CRLF = '\r\n'

/** BOM を外して 1 行ずつに割る（最後の CRLF の後ろの空要素は落とす） */
const lines = (text) => text.slice(1).split(CRLF).slice(0, -1)

// シナリオ: docs/unit/utils-csv.md
describe('utils/csv', () => {
  it('[CSU-01] 先頭に BOM が付く', () => {
    const text = buildCsv(['a'], [['1']])

    expect(text.startsWith(BOM)).toBe(true)
    expect(text.indexOf(BOM, 1)).toBe(-1)
  })

  it('[CSU-02] 各行の末尾（最終行も）に CRLF が付く', () => {
    const text = buildCsv(['a', 'b'], [
      ['1', '2'],
      ['3', '4'],
    ])

    expect(text).toBe(`${BOM}a,b${CRLF}1,2${CRLF}3,4${CRLF}`)
  })

  it('[CSU-03] カンマを含む値は " で囲む', () => {
    expect(lines(buildCsv(['a'], [['x,y']]))[1]).toBe('"x,y"')
  })

  it('[CSU-04] " を含む値は " で囲み、中の " は "" に重ねる', () => {
    expect(lines(buildCsv(['a'], [['say "hi"']]))[1]).toBe('"say ""hi"""')
  })

  it('[CSU-05] 改行（LF / CR）を含む値は " で囲む', () => {
    const text = buildCsv(['a', 'b'], [['x\ny', 'x\ry']])

    expect(text).toBe(`${BOM}a,b${CRLF}"x\ny","x\ry"${CRLF}`)
  })

  it('[CSU-06] null / undefined は空欄になる', () => {
    expect(lines(buildCsv(['a', 'b', 'c'], [[null, undefined, 'z']]))[1]).toBe(',,z')
  })

  it('[CSU-07] 0 と false は文字にして出す（空欄にしない）', () => {
    expect(lines(buildCsv(['a', 'b'], [[0, false]]))[1]).toBe('0,false')
  })

  it('[CSU-08] 行が 0 件ならヘッダの 1 行だけになる', () => {
    expect(buildCsv(['a', 'b'], [])).toBe(`${BOM}a,b${CRLF}`)
  })
})

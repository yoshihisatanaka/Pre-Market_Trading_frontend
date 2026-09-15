import { describe, expect, it } from 'vitest'
import { CA_TYPE_VALUES } from './apiEnums'
import { CA_TYPE_OPTIONS, formatCaType, isCaType } from './caTypes'

// シナリオ: docs/unit/utils-ca-types.md

/*
 * 比較相手は src/utils/apiEnums.js（docs/api/openapi.json の CATypeEnum の写し）。
 * ここに写しを手で置くと「自分で書いた 2 つを比べる」だけになり、
 * openapi.json が変わっても落ちない。取り込み直しの検知は apiEnums.spec.js（AEN-01/02）が担い、
 * **名前を付ける作業が要ることに気づく**のがこの CAT-01 の役目。
 * 落ちたら src/utils/caTypes.js に codes.json 由来の名前を付けて足す。
 */

describe('caTypes', () => {
  it('[CAT-01] 選択肢が CATypeEnum と同じコードを昇順で持ち、すべてに表示名がある', () => {
    expect(CA_TYPE_OPTIONS.map((option) => option.value)).toEqual([...CA_TYPE_VALUES])

    for (const option of CA_TYPE_OPTIONS) {
      expect(option.label).toBeTruthy()
    }
  })

  it('[CAT-02] コードを表示名に変換する', () => {
    expect(formatCaType('120')).toBe('株式分割')
    expect(formatCaType('110')).toBe('現金配当')
  })

  it('[CAT-03] 未知のコード・空値は — になる', () => {
    expect(formatCaType('999')).toBe('—')
    expect(formatCaType('')).toBe('—')
    expect(formatCaType()).toBe('—')
    expect(formatCaType(null)).toBe('—')
  })

  it('[CAT-04] CA種別コードかどうかを判定する', () => {
    expect(isCaType('110')).toBe(true)
    expect(isCaType('220')).toBe(true)
    expect(isCaType('999')).toBe(false)
    expect(isCaType('')).toBe(false)
    // 実 API の値はゼロ埋めされた文字列なので、数値は受け付けない
    expect(isCaType(110)).toBe(false)
    expect(isCaType()).toBe(false)
  })
})

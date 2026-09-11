import { describe, expect, it } from 'vitest'
import { CA_TYPE_OPTIONS, formatCaType, isCaType } from './caTypes'

// シナリオ: docs/unit/utils-ca-types.md

/*
 * docs/api/openapi.json の CATypeEnum が持つコード。
 * openapi.json を読み込んで比べるのではなく写しを置くのは、**取り込み直しで enum が増えたときに
 * ここが落ちて気づける**ようにするため（自動で追従すると、名前の無いコードが黙って増える）。
 * 落ちたら src/utils/caTypes.js とこの配列の両方に、codes.json 由来の名前を付けて足す。
 */
const CA_TYPE_ENUM = [
  '110',
  '112',
  '120',
  '121',
  '122',
  '123',
  '125',
  '130',
  '131',
  '140',
  '142',
  '220',
]

describe('caTypes', () => {
  it('[CAT-01] 選択肢が CATypeEnum と同じコードを昇順で持ち、すべてに表示名がある', () => {
    expect(CA_TYPE_OPTIONS.map((option) => option.value)).toEqual(CA_TYPE_ENUM)

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

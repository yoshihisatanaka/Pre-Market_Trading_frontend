import { describe, expect, it } from 'vitest'
import {
  ORDER_ROUTE_OPTIONS,
  REGULATION_OPTIONS,
  VWAP_TARGET_OPTIONS,
  formatOrderRoute,
  formatRegulation,
  formatVwapTarget,
  isOrderRoute,
  isRegulation,
  isVwapTarget,
} from './symbolTypes'

/*
 * 区分コードの対応表。**コード値そのものは固定しない**。
 * 規制情報の 0/1 は openapi.json に enum が無いための仮置きで、バックエンドの対応表が
 * 確認できたら差し替わる（src/utils/symbolTypes.js の冒頭コメント）。
 * 期待値は選択肢定数から導き、守るのは「選択肢の形」と「未知の値の扱い」だけにする。
 *
 * シナリオ: docs/unit/utils-symbol-types.md
 */

/** [区分の名前, 選択肢, format 関数, is 関数] */
const KINDS = [
  ['規制情報', REGULATION_OPTIONS, formatRegulation, isRegulation],
  ['注文ルート', ORDER_ROUTE_OPTIONS, formatOrderRoute, isOrderRoute],
  ['VWAP対象区分', VWAP_TARGET_OPTIONS, formatVwapTarget, isVwapTarget],
]

/** どの区分の選択肢にも無い値（未知のコードとして使う） */
const UNKNOWN = '999'

describe('symbolTypes', () => {
  it('[STT-01] 3 つの区分が { value, label } の選択肢を重複なく持つ', () => {
    for (const [name, options, ,] of KINDS) {
      expect(options.length, name).toBeGreaterThan(0)

      for (const option of options) {
        expect(typeof option.value, name).toBe('string')
        expect(option.value, name).toBeTruthy()
        expect(option.label, name).toBeTruthy()
      }

      const values = options.map((option) => option.value)
      expect(new Set(values).size, name).toBe(values.length)
      expect(values, name).not.toContain(UNKNOWN)
    }
  })

  it('[STT-02] コードを選択肢の表示名に変換する', () => {
    for (const [name, options, format] of KINDS) {
      for (const option of options) {
        expect(format(option.value), `${name}:${option.value}`).toBe(option.label)
      }
    }
  })

  it('[STT-03] 未知のコード・空値は — になる', () => {
    for (const [name, , format] of KINDS) {
      expect(format(UNKNOWN), name).toBe('—')
      expect(format(''), name).toBe('—')
      expect(format(), name).toBe('—')
      expect(format(null), name).toBe('—')
    }
  })

  it('[STT-04] 選択肢にあるコードは受け付ける', () => {
    for (const [name, options, , is] of KINDS) {
      for (const option of options) {
        expect(is(option.value), `${name}:${option.value}`).toBe(true)
      }
    }
  })

  it('[STT-05] 未知の値・空値・数値は受け付けない', () => {
    for (const [name, options, , is] of KINDS) {
      expect(is(UNKNOWN), name).toBe(false)
      expect(is(''), name).toBe(false)
      expect(is(), name).toBe(false)
      expect(is(null), name).toBe(false)
      // 実 API の値はゼロ埋めされた文字列なので、同じ見た目の数値は受け付けない
      expect(is(Number(options[0].value)), name).toBe(false)
    }
  })
})

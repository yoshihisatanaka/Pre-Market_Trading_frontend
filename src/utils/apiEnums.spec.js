import { describe, expect, it } from 'vitest'
import openapi from '../../docs/api/openapi.json'
import { codeName } from '@/mocks/fixtures/codes'
import * as apiEnums from './apiEnums'

// シナリオ: docs/unit/utils-api-enums.md

/*
 * ここだけは openapi.json を読み込んで突き合わせる（他の対応表は写しを手で持っている）。
 *
 * このファイルが持つのは値だけ。写しを手で置くと
 * 「自分で書いた 2 つを比べる」だけになり、openapi.json が変わっても落ちない
 * ——2026-09-15 の取り込みで区分値が 0 件から 21 種に増えたことに誰も気づかなかったのと同じ穴になる。
 *
 * このテストが落ちたら、バックエンドの区分が増減したということ。
 * src/utils/apiEnums.js を直し、参照している画面も必要なら追随させる。
 * 表示名はコードマスタ（GET /codes）から引くので、enum に増えた値に名称が付いているかは AEN-06 が
 * コードマスタの写し（src/mocks/fixtures/codes.js）と突き合わせて見る。
 */

/** openapi.json の enum スキーマ名 → 値（このファイルの期待値の出どころ） */
const SPEC_ENUMS = Object.fromEntries(
  Object.entries(openapi.components.schemas)
    .filter(([, schema]) => Array.isArray(schema.enum))
    .map(([name, schema]) => [name, schema.enum]),
)

/**
 * enum スキーマ名 → apiEnums.js の export 名。
 * 意味付きのものはオブジェクト、値だけのものは `*_VALUES` の配列で持つ。
 */
const EXPORT_BY_SCHEMA = {
  AccidentAccountTypeEnum: 'ACCIDENT_ACCOUNT_TYPE',
  AccountTypeEnum: 'ACCOUNT_TYPE',
  CorporateTypeEnum: 'CORPORATE_TYPE',
  HolidayTypeEnum: 'HOLIDAY_TYPE',
  MarketSessionCode: 'MARKET_SESSION_CODE',
  MarketState: 'MARKET_STATE',
  NisaContractEnum: 'NISA_CONTRACT',
  SpecificAccountTypeEnum: 'SPECIFIC_ACCOUNT_TYPE',
  SpecificDepositEnum: 'SPECIFIC_DEPOSIT',
  CATypeEnum: 'CA_TYPE_VALUES',
  ComplianceRankEnum: 'COMPLIANCE_RANK_VALUES',
  SideEnum: 'SIDE_VALUES',
  OrderTypeEnum: 'ORDER_TYPE_VALUES',
  OrderMethodEnum: 'ORDER_METHOD_VALUES',
  OrderChannelEnum: 'ORDER_CHANNEL_VALUES',
  CashDeliveryEnum: 'CASH_DELIVERY_VALUES',
  SecuritiesDeliveryEnum: 'SECURITIES_DELIVERY_VALUES',
  SettlementCurrencyEnum: 'SETTLEMENT_CURRENCY_VALUES',
  SolicitationEnum: 'SOLICITATION_VALUES',
  ExecutionScopeEnum: 'EXECUTION_SCOPE_VALUES',
  FundNatureEnum: 'FUND_NATURE_VALUES',
  DepositCategoryEnum: 'DEPOSIT_CATEGORY_VALUES',
  TransactionTypeEnum: 'TRANSACTION_TYPE_VALUES',
}

/**
 * apiEnums.js の export 名 → 画面が表示名を引くコードマスタのカテゴリ。
 * enum に値が増えたのにコードマスタに名称が無いと、選択肢から黙って落ちる（pickOptions）か「—」になる。
 */
const CODE_CATEGORY_BY_EXPORT = {
  ACCIDENT_ACCOUNT_TYPE: '事故処理口座区分',
  ACCOUNT_TYPE: '口座区分',
  CORPORATE_TYPE: '法人区分',
  HOLIDAY_TYPE: '海外休場区分',
  NISA_CONTRACT: 'NISA契約',
  SPECIFIC_ACCOUNT_TYPE: '特定口座区分',
  SPECIFIC_DEPOSIT: '特定預り区分',
  CA_TYPE_VALUES: 'CA種別',
  COMPLIANCE_RANK_VALUES: 'コンプラランク',
  SIDE_VALUES: '売買区分',
  ORDER_TYPE_VALUES: '指成区分',
  ORDER_METHOD_VALUES: '受注方法',
  ORDER_CHANNEL_VALUES: '注文チャネル',
  SETTLEMENT_CURRENCY_VALUES: '決済通貨区分',
  SOLICITATION_VALUES: '勧誘区分',
  EXECUTION_SCOPE_VALUES: '発注範囲',
  FUND_NATURE_VALUES: '資金性格',
  DEPOSIT_CATEGORY_VALUES: '預り売買区分',
}

/** export の中身を値の配列にそろえる（オブジェクトは値だけ取り出す） */
function valuesOf(exported) {
  return Array.isArray(exported) ? [...exported] : Object.values(exported)
}

describe('apiEnums', () => {
  it('[AEN-01] openapi.json の enum をすべて過不足なく持つ', () => {
    expect(Object.keys(SPEC_ENUMS).sort()).toEqual(Object.keys(EXPORT_BY_SCHEMA).sort())

    for (const name of Object.values(EXPORT_BY_SCHEMA)) {
      expect(apiEnums[name], `${name} が export されていない`).toBeDefined()
    }
  })

  it('[AEN-02] 各区分の値が openapi.json の enum と一致する', () => {
    for (const [schema, exportName] of Object.entries(EXPORT_BY_SCHEMA)) {
      expect(valuesOf(apiEnums[exportName]), `${schema} と ${exportName} がずれている`).toEqual(
        SPEC_ENUMS[schema],
      )
    }
  })

  it('[AEN-03] すべて凍結されていて書き換えられない', () => {
    for (const exportName of Object.values(EXPORT_BY_SCHEMA)) {
      expect(Object.isFrozen(apiEnums[exportName]), `${exportName} が凍結されていない`).toBe(true)
    }
  })

  it('[AEN-04] 意味付きの区分はキーと値が 1 対 1 になっている', () => {
    const named = Object.values(EXPORT_BY_SCHEMA).filter(
      (exportName) => !Array.isArray(apiEnums[exportName]),
    )
    // 意味が spec に書かれている 9 種。残りは値だけの配列で持つ
    expect(named).toHaveLength(9)

    for (const exportName of named) {
      const values = Object.values(apiEnums[exportName])
      expect(new Set(values).size, `${exportName} の値に重複がある`).toBe(values.length)
    }
  })

  it('[AEN-05] 値はすべて文字列（実 API のゼロ埋め文字列に合わせる）', () => {
    for (const exportName of Object.values(EXPORT_BY_SCHEMA)) {
      for (const value of valuesOf(apiEnums[exportName])) {
        expect(typeof value, `${exportName} に文字列でない値がある`).toBe('string')
      }
    }
  })

  it('[AEN-06] 画面が名称をコードマスタから引く区分は、enum の全値にコードマスタの名称がある', () => {
    for (const [exportName, category] of Object.entries(CODE_CATEGORY_BY_EXPORT)) {
      for (const value of valuesOf(apiEnums[exportName])) {
        expect(codeName(category, value), `${exportName} の ${value} が ${category} に無い`).toBeTruthy()
      }
    }
  })
})

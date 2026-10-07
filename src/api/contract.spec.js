import { File as NodeFile } from 'node:buffer'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import openapi from '../../docs/api/openapi.json'
import { server } from '../mocks/server'
import { branchListResponse, handlerListResponse } from '../mocks/fixtures/codes'
import { canceledSymbols, symbols } from '../mocks/fixtures/symbols'
import { canceledCustomers, customers } from '../mocks/fixtures/customers'
import { canceledCorporateActions, corporateActions } from '../mocks/fixtures/ca'
import { blackoutDates, canceledBlackoutDates } from '../mocks/fixtures/blackoutDates'
import { canceledMarketHolidays, marketHolidays } from '../mocks/fixtures/marketHolidays'
import { sliceCriteriaSetting } from '../mocks/fixtures/sliceCriteria'
import { canceledFxRates, fxRates } from '../mocks/fixtures/fxRates'
import { calculationSetting } from '../mocks/fixtures/calculationSettings'
import { activityLogs } from '../mocks/fixtures/activityLogs'
import { activityLogTargets } from '../mocks/fixtures/activityLogTargets'
import { rolePermissions } from '../mocks/fixtures/permissions'
import {
  noOperationOperator,
  salesOperator,
  supervisorOperator,
  viewerOperator,
} from '../mocks/fixtures/currentOperator'
import {
  balanceAdjustments,
  canceledBalanceAdjustments,
} from '../mocks/fixtures/balanceAdjustments'
import {
  closedMarketStatusResponse,
  marketStatusResponse,
  shortenedMarketStatusResponse,
} from '../mocks/fixtures/marketStatus'
import {
  announcement,
  announcementHistories,
  initialAnnouncement,
} from '../mocks/fixtures/announcements'
import {
  incidentBannerResponse,
  noneBannerResponse,
  noticeBannerResponse,
} from '../mocks/fixtures/banner'
import { suspensionHistories, suspensionTargets } from '../mocks/fixtures/incidents'
import { mizuhoExecutions } from '../mocks/fixtures/mizuhoExecutions'
import { closedMizuhoClosingStatus, mizuhoClosingStatus } from '../mocks/fixtures/closing'
import { executions } from '../mocks/fixtures/executions'
import { orderInquiryRows } from '../mocks/fixtures/orderInquiry'
import { holdings } from '../mocks/fixtures/holdings'
import { dreamOrders, dreamStatusCodes } from '../mocks/fixtures/dreamStatus'
import {
  bulkOrderCreateResponse,
  orderCsvSpecResponse,
  orderCsvValidateResponse,
  orderCsvValidateWithErrorsResponse,
} from '../mocks/fixtures/orderCsv'
import { orderCreateExamples, orderValidationExamples } from '../mocks/fixtures/orderEntry'
import { calculationExamples } from '../mocks/fixtures/calculations'
import { fetchOrders } from './orders'
import { amendOrder, cancelOrder, fetchOrderDetail, fetchOrderInquiry } from './orderInquiry'
import { fetchBranches, fetchCodes, fetchHandlers } from './codes'
import { fetchCustomer, fetchCustomers } from './customers'
import { fetchHoldings } from './holdings'
import {
  createCorporateAction,
  deleteCorporateAction,
  fetchCorporateActions,
  updateCorporateAction,
  validateCorporateAction,
} from './ca'
import {
  createSymbol,
  deleteSymbol,
  disableAllVwapTargets,
  fetchSymbols,
  previewDisableAllVwapTargets,
  updateSymbol,
  validateSymbol,
} from './symbols'
import {
  createMarketHoliday,
  deleteMarketHoliday,
  fetchMarketHolidays,
  validateMarketHoliday,
} from './marketHolidays'
import {
  createBlackoutDate,
  deleteBlackoutDate,
  fetchBlackoutDates,
  updateBlackoutDate,
  validateBlackoutDate,
} from './blackoutDates'
import { fetchSliceCriteria, updateSliceCriteria } from './sliceCriteria'
import {
  createFxRate,
  fetchFxRate,
  fetchLatestFxRate,
  updateFxRate,
  validateFxRate,
} from './fxRates'
import { fetchCalculationSettings, updateCalculationSettings } from './calculationSettings'
import { fetchActivityLogTargets, fetchActivityLogs } from './activityLogs'
import { fetchStalledOrders, importConfirmationCsv } from './stalledOrders'
import { fetchPermissions, updateRolePermission } from './permissions'
import { fetchCurrentOperator } from './auth'
import { fetchMarketStatus } from './marketStatus'
import {
  createBalanceAdjustment,
  fetchBalanceAdjustments,
  updateBalanceAdjustment,
  updateBalanceSellProhibited,
} from './balanceAdjustments'
import { fetchAnnouncement, fetchAnnouncementHistory, updateAnnouncement } from './announcements'
import { fetchBanner } from './banner'
import {
  fetchSuspensionHistories,
  fetchSuspensionStatus,
  resumeOrders,
  suspendOrders,
} from './incidents'
import { fetchMizuhoExecutions } from './mizuhoExecutions'
import { closeMizuhoOrders, fetchMizuhoClosingStatus, reopenMizuhoOrders } from './closing'
import { exportMizuhoOrderSheet } from './mizuho'
import { exportExecutionsCsv, fetchExecutions } from './executions'
import { changeDreamStatus, fetchDreamOrders, fetchDreamStatusCodes } from './dreamStatus'
import {
  bulkCreateOrders,
  fetchOrderCsvSpec,
  fetchOrderCsvTemplate,
  validateOrderCsv,
} from './orderCsv'
import { createOrder, validateOrder } from './orderEntry'
import { calculate } from './calculations'

// シナリオ: docs/unit/api-contract.md

/*
 * 契約テスト。openapi.json（フロント実装上の正）と、フロントが「バックエンドの形」を知っている
 * 2 か所 —— src/api/（送り出すリクエスト）と src/mocks/fixtures/（受け取る生データの写し）——
 * を突き合わせる。
 *
 * 何のために在るか。仕様の取り込みでクエリ名やパスが変わっても、旧名は**無視されるだけで
 * エラーにならない**（FastAPI は知らないクエリを黙って捨てる）。2026-09-15 の /masters/ 移行と
 * クエリ改名、09-16 の stock_code → symbol、CA のステータス項目の追加→取り消しは、いずれも
 * 実 API に当てるまで気づけなかった。このテストは取り込み当日に落ちる。
 *
 * 見るもの:
 *   - フィクスチャの各行が対応スキーマ（*Item）の properties / required / 型に合っているか
 *   - src/api/ が実際に送るリクエスト（MSW が捕まえたもの）のパスが仕様に在るか、
 *     クエリ名が仕様の parameters に在るか、integer のパスパラメータに整数以外を送っていないか
 *
 * 見ないもの: 値の意味（銘柄コードの桁など）、レスポンスの変換結果（それは各 api/*.spec.js）。
 *
 * **既知の食い違いは KNOWN_GAPS に理由付きで載せる。** 載せたものは CON-07 が
 * 「まだ食い違っている」ことを確かめるので、解消したら落ちて一覧から外すことになる（放置できない）。
 * KNOWN_GAPS の行は必ず docs/api/requests.md にも依頼の行を持つ。
 */

/** リクエストの捕捉に使うベースパス（vite の proxy が剥がす目印。仕様のパスには無い） */
const BASE_PATH = '/api'

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch'])

/** `$ref` を components/schemas の実体に置き換える（無ければそのまま） */
function resolveRef(schema) {
  if (!schema || typeof schema !== 'object' || !schema.$ref) return schema
  const name = schema.$ref.split('/').pop()
  return openapi.components.schemas[name]
}

/** 仕様の全オペレーション。パスのテンプレートを正規表現に直して持つ */
const OPERATIONS = Object.entries(openapi.paths).flatMap(([template, item]) => {
  const shared = item.parameters ?? []
  return Object.entries(item)
    .filter(([method]) => METHODS.has(method))
    .map(([method, op]) => ({
      method: method.toUpperCase(),
      template,
      regex: new RegExp(`^${template.replace(/\{[^}]+\}/g, '([^/]+)')}$`),
      paramNames: [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
      parameters: [...shared, ...(op.parameters ?? [])].map((p) => resolveRef(p) ?? p),
    }))
})

/**
 * メソッドとパスから仕様のオペレーションを引く。
 * `/masters/symbols/validate` は `/masters/symbols/{symbol}` にも一致するので、
 * パスパラメータの少ないテンプレート（静的な方）を優先する。
 */
function findOperation(method, path) {
  return OPERATIONS.filter((op) => op.method === method && op.regex.test(path)).sort(
    (a, b) => a.paramNames.length - b.paramNames.length,
  )[0]
}

/** 仕様のパステンプレート（`{x}` 付き）とメソッドでオペレーションを引く（KNOWN_GAPS の照合用） */
function findOperationByTemplate(method, template) {
  return OPERATIONS.find((op) => op.method === method && op.template === template)
}

/* ---------- 既知の食い違い ---------- */

/**
 * 既知の食い違い。1 行 = 1 件で、`request` は docs/api/requests.md の依頼番号。
 *
 *   kind: 'fixture' … フィクスチャがスキーマと合わない（fixture 名で指す）。
 *                     `keys` を付けると「その項目が仕様に無い」ことだけを許す（ほかの食い違いは落とす）。
 *                     付けなければフィクスチャ全体を対象から外す
 *   kind: 'path'    … src/api/ が送るパスが仕様に無い（実際に送るパス）
 *   kind: 'query'   … src/api/ が送るクエリ名が仕様の parameters に無い（仕様のテンプレートで指す）
 */
const KNOWN_GAPS = [
  /*
   * 操作ログは 2026-09-24 に ActivityLogItem の形へ張り替えた。画面モックにあった 5 項目を
   * フィクスチャに契約提案として載せていたが、操作者名 / 実行者区分 / 対象機能 / 操作内容 の 4 項目は
   * 2026-09-30 の取り込みで仕様に入ったので外した。残るのは 結果 だけ（src/api/activityLogs.js は読まない）。
   */
  {
    kind: 'fixture',
    fixture: 'activityLogs',
    keys: ['結果'],
    reason:
      '画面モックにあった項目。ActivityLogItem に無いので画面には出さず、フィクスチャに契約提案として残している',
    request: '#1',
  },
  /*
   * 障害管理の履歴の更新者は、画面モックがコードの下に氏名を出す。SuspensionHistoryItem には
   * 操作者（コード）しか無いので、氏名をフィクスチャに契約提案として載せている（src/api/incidents.js は
   * あれば読む）。仕様に入った日に CON-07 が落ちて気づける。
   */
  {
    kind: 'fixture',
    fixture: 'suspensionHistories',
    keys: ['操作者名'],
    reason: '画面モックの更新者列（コード＋氏名）に要る項目。SuspensionHistoryItem に無い',
    request: '#48',
  },
  /*
   * 一覧の *Item が ID を返すようになった（2026-09-18 の取り込み）。フロントが先行して
   * 主キーを id に寄せていた間はここに keys: ['ID'] の行を置いていたが、仕様に入ったので外した。
   * 残っているのは更新系のパスキーで、そちらは型で検出できない（CON-06 のコメント）。
   */
  /*
   * 権限マスタは 2026-09-25 に RolePermissionItem の形（日本語キー・4 権限）へ張り替えた。
   * 画面モック由来の英語キー・5 権限の食い違い（#4）は解消したので行を外した。
   */
  /*
   * 顧客マスタの検索クエリ（handler_code / restriction / account_type / corporate_type。#8）は
   * 2026-09-30 の取り込みで仕様に入ったので行を外した。
   */
  /*
   * 変更検証の対象を渡すクエリ（blackout_date_id / symbol_id / account_id …）は
   * 2026-09-18 の取り込みで全マスタに入った。先行実装の食い違いは解消したので行を外した。
   */
  /*
   * 滞留注文抽出は API が 1 本も無い（成熟度 D）。形は src/mocks/fixtures/stalledOrders.js が
   * 契約提案で、MSW だけが応答する。一覧のパス自体が仕様に無いので kind: 'path' で載せる。
   */
  {
    kind: 'path',
    method: 'GET',
    path: '/operations/stalled-orders',
    reason: '滞留注文抽出の検索 API が仕様に無い。fixture を契約提案として先に置いている',
    request: '#1',
  },
  /*
   * コンファメーション CSV の取込も同じく仕様に無い。パスと項目名（file）は docs/api/requests.md の
   * 契約提案で、応答は既存の CsvImportResponse を流用する前提。MSW だけが応答する。
   */
  {
    kind: 'path',
    method: 'POST',
    path: '/operations/stalled-orders/confirmation-import',
    reason:
      'コンファメーション CSV の取込 API が仕様に無い。MSW のハンドラを契約提案として先に置いている',
    request: '#1',
  },
  /*
   * 残高マスタの銘柄名の検索は画面モックにだけある条件で、src/api/balanceAdjustments.js の
   * 冒頭コメントの 1 番。MSW だけが解釈し、実 API は黙って無視する。
   * 4 番（売却不可区分）は 2026-09-25 の取り込みで仕様に入ったので行を外した。
   */
  {
    kind: 'query',
    method: 'GET',
    template: '/masters/balance-adjustments',
    names: ['symbol_name'],
    reason: '画面モックの「銘柄名」検索。実 API は無視するので絞り込みが黙って効かない',
    request: '#13',
  },
  /*
   * CSV一括注文のプレビューに出す顧客名（CsvOrderRowResult.customer_name。#27）は
   * 2026-09-30 の取り込みで仕様に入ったので、orderCsvValidateRows / orderCsvValidate /
   * orderCsvValidateWithErrors の 3 行をまとめて外した。
   */
]

function knownQueryGap(op, name) {
  return KNOWN_GAPS.some(
    (gap) =>
      gap.kind === 'query' &&
      gap.method === op.method &&
      gap.template === op.template &&
      gap.names.includes(name),
  )
}

function knownPathGap(method, path) {
  return KNOWN_GAPS.some((gap) => gap.kind === 'path' && gap.method === method && gap.path === path)
}

/** フィクスチャ全体を対象から外す既知の食い違いがあるか（`keys` 無しの fixture gap） */
function wholeFixtureGap(name) {
  return KNOWN_GAPS.some((gap) => gap.kind === 'fixture' && gap.fixture === name && !gap.keys)
}

/** そのフィクスチャで「仕様に無い」ことを許している項目名 */
function toleratedKeys(name) {
  return KNOWN_GAPS.filter(
    (gap) => gap.kind === 'fixture' && gap.fixture === name && gap.keys,
  ).flatMap((gap) => gap.keys)
}

/** 既知の食い違いを除いた、フィクスチャの問題（CON-01〜03 の共通の入口） */
function unexpectedFixtureProblems(fixture) {
  if (wholeFixtureGap(fixture.name)) return []
  const tolerated = toleratedKeys(fixture.name).map((key) => `仕様に無い項目 "${key}"`)
  return fixtureProblems(fixture).filter((p) => !tolerated.some((t) => p.endsWith(t)))
}

/* ---------- フィクスチャ ↔ スキーマ ---------- */

/** フィクスチャの生データと、それが写しているはずのスキーマ名 */
const FIXTURES = [
  { name: 'branches', schema: 'BranchItem', rows: branchListResponse.items },
  { name: 'handlers', schema: 'HandlerItem', rows: handlerListResponse.items },
  { name: 'symbols', schema: 'SymbolItem', rows: [...symbols, ...canceledSymbols] },
  { name: 'customers', schema: 'CustomerItem', rows: [...customers, ...canceledCustomers] },
  { name: 'ca', schema: 'CAItem', rows: [...corporateActions, ...canceledCorporateActions] },
  {
    name: 'blackoutDates',
    schema: 'BlackoutDateItem',
    rows: [...blackoutDates, ...canceledBlackoutDates],
  },
  {
    name: 'marketHolidays',
    schema: 'MarketHolidayItem',
    rows: [...marketHolidays, ...canceledMarketHolidays],
  },
  { name: 'sliceCriteria', schema: 'SliceSettingResponse', rows: [sliceCriteriaSetting] },
  { name: 'fxRates', schema: 'FxItem', rows: [...fxRates, ...canceledFxRates] },
  { name: 'calculationSettings', schema: 'CalculationSettingItem', rows: [calculationSetting] },
  { name: 'activityLogs', schema: 'ActivityLogItem', rows: activityLogs },
  { name: 'activityLogTargets', schema: 'ActivityLogTargetItem', rows: activityLogTargets },
  { name: 'permissions', schema: 'RolePermissionItem', rows: rolePermissions },
  {
    name: 'currentOperator',
    schema: 'CurrentOperatorResponse',
    rows: [supervisorOperator, viewerOperator, noOperationOperator, salesOperator],
  },
  {
    name: 'balanceAdjustments',
    schema: 'BalanceAdjustmentItem',
    rows: [...balanceAdjustments, ...canceledBalanceAdjustments],
  },
  /*
   * 一覧の *Item ではなくレスポンス全体が対象。sessions[] は items.$ref 経由で
   * MarketSessionItem として型検査される（typeProblems の array → items）。
   */
  {
    name: 'marketStatus',
    schema: 'MarketStatusResponse',
    rows: [marketStatusResponse, closedMarketStatusResponse, shortenedMarketStatusResponse],
  },
  { name: 'announcements', schema: 'AnnouncementItem', rows: [announcement, initialAnnouncement] },
  {
    name: 'announcementHistories',
    schema: 'AnnouncementHistoryItem',
    rows: announcementHistories,
  },
  {
    name: 'banner',
    schema: 'BannerResponse',
    rows: [incidentBannerResponse, noticeBannerResponse, noneBannerResponse],
  },
  { name: 'suspensionTargets', schema: 'SuspensionTargetItem', rows: suspensionTargets },
  { name: 'suspensionHistories', schema: 'SuspensionHistoryItem', rows: suspensionHistories },
  { name: 'mizuhoExecutions', schema: 'ExecutionItem', rows: mizuhoExecutions },
  {
    name: 'closing',
    schema: 'ClosingStatusResponse',
    rows: [mizuhoClosingStatus, closedMizuhoClosingStatus],
  },
  { name: 'executions', schema: 'ExecutionItem', rows: executions },
  { name: 'orderInquiry', schema: 'OrderItemResponse', rows: orderInquiryRows },
  { name: 'holdings', schema: 'HoldingItem', rows: holdings },
  { name: 'dreamOrders', schema: 'DreamOrderItem', rows: dreamOrders },
  { name: 'dreamStatusCodes', schema: 'DreamStatusCodeItem', rows: dreamStatusCodes },
  // レスポンス全体が対象。columns[] は items.$ref 経由で CsvColumnSpec として型検査される
  { name: 'orderCsvSpec', schema: 'CsvHeaderSpecResponse', rows: [orderCsvSpecResponse] },
  // 新規注文の応答はレスポンス全体が対象（MSW のハンドラが同じ形で組み立てて返す）
  {
    name: 'orderValidation',
    schema: 'OrderValidationResponse',
    rows: orderValidationExamples,
  },
  { name: 'orderCreate', schema: 'OrderCreateResponse', rows: orderCreateExamples },
  /*
   * レスポンス全体が対象。rows[] は CsvOrderRowResult、rows[].details は ValidationDetails として型検査される。
   * rows[].data は additionalProperties の object（中身の型は仕様に無い）なので項目名は見られない
   */
  { name: 'orderCsvValidate', schema: 'CsvOrderValidateResponse', rows: [orderCsvValidateResponse] },
  {
    name: 'orderCsvValidateWithErrors',
    schema: 'CsvOrderValidateResponse',
    rows: [orderCsvValidateWithErrorsResponse],
  },
  // 行だけを直に写したもの。入れ子の rows[] の中の項目を CsvOrderRowResult と直に突き合わせる
  {
    name: 'orderCsvValidateRows',
    schema: 'CsvOrderRowResult',
    rows: [...orderCsvValidateResponse.rows, ...orderCsvValidateWithErrorsResponse.rows],
  },
  { name: 'bulkOrderCreate', schema: 'BulkOrderCreateResponse', rows: [bulkOrderCreateResponse] },
  /*
   * 仮計算の応答はレスポンス全体が対象（MSW のハンドラが同じ組み立てで返す）。
   * 外貨 / 円貨 / 手数料パラメータ / 計算パラメータは $ref 経由で入れ子まで型検査される
   */
  { name: 'calculation', schema: 'CalculationResponse', rows: calculationExamples },
]

function describeSchema(schema) {
  if (!schema) return '(未定義)'
  if (schema.anyOf) return schema.anyOf.map(describeSchema).join(' | ')
  if (schema.enum) return `enum(${schema.enum.join(', ')})`
  return schema.type ?? 'object'
}

/**
 * 値がスキーマに合わない理由を配列で返す（合えば空）。
 * 見るのは型・enum・nullable・配列の要素・入れ子の object の properties まで。
 */
function typeProblems(value, rawSchema, at) {
  const schema = resolveRef(rawSchema)
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return []

  if (schema.anyOf) {
    const fits = schema.anyOf.some((option) => typeProblems(value, option, at).length === 0)
    return fits ? [] : [`${at}: ${JSON.stringify(value)} は ${describeSchema(schema)} に合わない`]
  }
  if (schema.enum) {
    return schema.enum.includes(value)
      ? []
      : [`${at}: ${JSON.stringify(value)} は ${describeSchema(schema)} に無い`]
  }

  const mismatch = () => [`${at}: ${JSON.stringify(value)} は ${describeSchema(schema)} ではない`]
  switch (schema.type) {
    case 'integer':
      return Number.isInteger(value) ? [] : mismatch()
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? [] : mismatch()
    case 'string':
      return typeof value === 'string' ? [] : mismatch()
    case 'boolean':
      return typeof value === 'boolean' ? [] : mismatch()
    case 'null':
      return value === null ? [] : mismatch()
    case 'array':
      if (!Array.isArray(value)) return mismatch()
      return value.flatMap((item, i) => typeProblems(item, schema.items, `${at}[${i}]`))
    case 'object':
      if (schema.properties) return objectProblems(value, schema, at)
      return typeof value === 'object' && value !== null ? [] : mismatch()
    case undefined:
      /*
       * 型の宣言が無い。properties があれば object として見るが、無ければ何でもよい
       * （CsvColumnSpec.example は `{ title }` だけで、列ごとに string / integer / number が来る）。
       */
      if (schema.properties) return objectProblems(value, schema, at)
      return []
    default:
      return []
  }
}

/** 1 行（object）がスキーマの properties / required / 型に合わない理由 */
function objectProblems(row, rawSchema, at) {
  const schema = resolveRef(rawSchema)
  if (typeof row !== 'object' || row === null) return [`${at}: object ではない`]

  const problems = []
  const properties = schema.properties ?? {}
  if (!schema.additionalProperties) {
    for (const key of Object.keys(row)) {
      if (!(key in properties)) problems.push(`${at}: 仕様に無い項目 "${key}"`)
    }
  }
  for (const key of schema.required ?? []) {
    if (!(key in row)) problems.push(`${at}: 必須項目 "${key}" が無い`)
  }
  for (const [key, propSchema] of Object.entries(properties)) {
    if (key in row) problems.push(...typeProblems(row[key], propSchema, `${at}.${key}`))
  }
  return problems
}

/** フィクスチャ 1 セットぶんの問題（行ごとに集める。同じ理由は 1 回だけ出す） */
function fixtureProblems({ name, schema, rows }) {
  const spec = openapi.components.schemas[schema]
  if (!spec) return [`${name}: スキーマ ${schema} が openapi.json に無い`]

  const seen = new Set()
  return rows.flatMap((row, i) =>
    objectProblems(row, spec, `${name}[${i}]`).filter((problem) => {
      // 行番号を除いた理由で重複を潰す（56 行が同じ項目で落ちても 1 行で判る）
      const key = problem.replace(/^\w+\[\d+\]/, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  )
}

/* ---------- src/api/ が送るリクエスト ---------- */

/** 新規注文の事前検証・登録に渡す 1 件（src/api/orderEntry.js の OrderInput。全項目を埋める） */
const PROBE_ORDER = {
  branchCode: '123',
  accountNumber: '1230004',
  symbolCode: 'S001',
  side: '3',
  quantity: 10,
  orderType: 'LO',
  limitPrice: 200,
  executionScope: '03',
  expiryDate: '2026-09-30',
  settlementCurrency: '0',
  depositCategory: '0',
  securitiesDelivery: '500',
  transactionType: '100',
  solicitation: '1',
  orderMethod: '3',
  fundNature: '1',
  orderChannel: 'EGY',
  cashDelivery: '000',
  vwap: false,
  orderDate: '2026-09-29',
  orderTime: '10:30',
  orderPerson: '001',
  forced: false,
  createdBy: '001',
}

/**
 * src/api/ の関数を 1 つずつ呼び、MSW が捕まえたリクエストを控える。
 * 応答は見ない（404 / 409 / 422 で例外になっても、リクエストの形は既に出ている）。
 * 引数はすべての絞り込みを埋めて、送れるクエリを全部送らせる。
 */
const PROBES = [
  { name: 'fetchOrders', run: () => fetchOrders() },
  {
    name: 'fetchOrderInquiry',
    run: () =>
      fetchOrderInquiry({
        branchCode: '123',
        accountNumber: '300001',
        symbol: 'AAPL',
        executionStatus: '003',
      }),
  },
  { name: 'fetchOrderDetail', run: () => fetchOrderDetail('35') },
  {
    name: 'amendOrder',
    run: () =>
      amendOrder({
        id: '36',
        quantity: 30,
        orderType: 'LO',
        limitPrice: 144,
        marketScope: '02',
        reason: 'x',
      }),
  },
  { name: 'cancelOrder', run: () => cancelOrder({ id: '36' }) },
  { name: 'fetchCodes', run: () => fetchCodes() },
  { name: 'fetchBranches', run: () => fetchBranches() },
  { name: 'fetchHandlers', run: () => fetchHandlers() },
  {
    name: 'fetchCustomers',
    run: () =>
      fetchCustomers({
        branchCode: '001',
        handlerCode: '001',
        accountNumber: '1234567',
        customerName: '田中',
        restriction: '0',
        accountType: '1',
        corporateType: '1',
      }),
  },
  { name: 'fetchCustomer', run: () => fetchCustomer('1') },
  {
    name: 'fetchHoldings',
    run: () =>
      fetchHoldings({
        limit: 200,
        offset: 0,
        branchCode: '123',
        accountNumber: '1230001',
        customerName: '山田',
        symbol: 'AAPL',
        symbolName: 'Apple',
        specificDeposit: '1',
      }),
  },
  {
    name: 'fetchCorporateActions',
    run: () => fetchCorporateActions({ stockCode: 'AAPL', caType: '110' }),
  },
  {
    name: 'validateCorporateAction',
    run: () => validateCorporateAction({ id: '1', stockCode: 'AAPL', caType: '110' }),
  },
  {
    name: 'createCorporateAction',
    run: () => createCorporateAction({ stockCode: 'AAPL', caType: '110' }),
  },
  {
    name: 'updateCorporateAction',
    run: () => updateCorporateAction({ id: '1', stockCode: 'AAPL', caType: '110' }),
  },
  { name: 'deleteCorporateAction', run: () => deleteCorporateAction('1') },
  {
    name: 'fetchSymbols',
    run: () =>
      fetchSymbols({
        symbolCode: 'AAPL',
        ticker: 'AAPL',
        regulation: '0',
        orderRoute: '0',
        vwapTarget: '0',
      }),
  },
  // 銘柄名は ASCII 以外なら symbol_name_ja、ASCII だけなら symbol_name_en に乗る（両方を 1 回ずつ通す）
  { name: 'fetchSymbols (symbol_name_ja)', run: () => fetchSymbols({ symbolName: 'アップル' }) },
  { name: 'fetchSymbols (symbol_name_en)', run: () => fetchSymbols({ symbolName: 'Apple' }) },
  { name: 'previewDisableAllVwapTargets', run: () => previewDisableAllVwapTargets() },
  { name: 'disableAllVwapTargets', run: () => disableAllVwapTargets() },
  {
    name: 'validateSymbol',
    run: () => validateSymbol({ id: '1', symbolCode: 'AAPL', ticker: 'AAPL', name: 'x' }),
  },
  {
    name: 'createSymbol',
    run: () => createSymbol({ symbolCode: 'ZZZ9', ticker: 'ZZZ9', name: 'x' }),
  },
  {
    name: 'updateSymbol',
    run: () => updateSymbol({ id: '1', symbolCode: 'AAPL', ticker: 'AAPL', name: 'x' }),
  },
  { name: 'deleteSymbol', run: () => deleteSymbol('1') },
  {
    name: 'fetchMarketHolidays',
    run: () =>
      fetchMarketHolidays({ dateFrom: '2026-01-01', dateTo: '2026-12-31', holidayType: '0' }),
  },
  {
    name: 'validateMarketHoliday',
    run: () =>
      validateMarketHoliday({ date: '2031-01-01', reason: 'x', holidayType: '0', id: '1' }),
  },
  {
    name: 'createMarketHoliday',
    run: () => createMarketHoliday({ date: '2031-01-01', reason: 'x', holidayType: '0' }),
  },
  { name: 'deleteMarketHoliday', run: () => deleteMarketHoliday('1') },
  {
    name: 'fetchBlackoutDates',
    run: () => fetchBlackoutDates({ dateFrom: '2026-01-01', dateTo: '2026-12-31' }),
  },
  // 画面の検索欄（1 日）は単一指定の blackout_date に乗る
  { name: 'fetchBlackoutDates (date)', run: () => fetchBlackoutDates({ date: '2026-12-30' }) },
  {
    name: 'validateBlackoutDate',
    run: () => validateBlackoutDate({ date: '2031-01-01', reason: 'x', id: '1' }),
  },
  {
    name: 'createBlackoutDate',
    run: () => createBlackoutDate({ date: '2031-01-01', reason: 'x' }),
  },
  {
    name: 'updateBlackoutDate',
    run: () => updateBlackoutDate({ id: '1', date: '2031-01-02', reason: 'x', updatedAt: '' }),
  },
  { name: 'deleteBlackoutDate', run: () => deleteBlackoutDate('1') },
  { name: 'fetchSliceCriteria', run: () => fetchSliceCriteria() },
  {
    name: 'updateSliceCriteria',
    run: () =>
      updateSliceCriteria({
        participationRate: 0.1,
        maxQuantity: 1,
        maxAmount: 1,
        sliceEnabled: true,
        note: '',
        updatedAt: '',
      }),
  },
  {
    name: 'fetchLatestFxRate',
    run: () => fetchLatestFxRate({ currencyCode: 'USD', targetDate: '2026-07-31' }),
  },
  { name: 'fetchFxRate', run: () => fetchFxRate('1') },
  {
    name: 'validateFxRate',
    run: () => validateFxRate({ baseDate: '2026-07-31', currencyCode: 'USD', rate: 1, id: '1' }),
  },
  {
    name: 'createFxRate',
    run: () => createFxRate({ baseDate: '2031-01-01', currencyCode: 'USD', rate: 1 }),
  },
  {
    name: 'updateFxRate',
    run: () =>
      updateFxRate({ id: '1', baseDate: '2026-07-25', currencyCode: 'USD', rate: 1, updatedAt: '' }),
  },
  { name: 'fetchCalculationSettings', run: () => fetchCalculationSettings() },
  {
    name: 'updateCalculationSettings',
    run: () =>
      updateCalculationSettings({
        exchangeTaxRate: 0.0001,
        localCommissionBp: 1,
        fxSpread: 1,
        nisaFxMarkupRate: 1,
        updatedAt: '',
      }),
  },
  {
    name: 'fetchActivityLogs',
    run: () =>
      fetchActivityLogs({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        operator: '001',
        operation: 'UPDATE',
        targetTypes: ['customers'],
        targetKey: 'x',
        sort: 'asc',
      }),
  },
  { name: 'fetchActivityLogTargets', run: () => fetchActivityLogTargets() },
  {
    name: 'fetchStalledOrders',
    run: () => fetchStalledOrders({ branchCode: '123', accountNumber: '1234567', symbol: 'AAPL' }),
  },
  {
    name: 'importConfirmationCsv',
    /*
     * jsdom の FormData は MSW(node) が Request に変換できず POST が止まる。
     * この呼び出しの間だけ Node（undici）の FormData と File に差し替える（stalledOrders.spec.js と同じ回避）
     */
    run: async () => {
      const form = await new Response('', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).formData()
      vi.stubGlobal('FormData', form.constructor)
      try {
        await importConfirmationCsv(new NodeFile(['order_id\r\n'], 'c.csv', { type: 'text/csv' }))
      } finally {
        vi.unstubAllGlobals()
      }
    },
  },
  { name: 'fetchPermissions', run: () => fetchPermissions() },
  {
    name: 'updateRolePermission',
    run: () =>
      updateRolePermission('sales', {
        canOrder: true,
        canMasterUpdate: false,
        canOperation: false,
        canBranchAll: false,
        updatedAt: '',
      }),
  },
  { name: 'fetchCurrentOperator', run: () => fetchCurrentOperator() },
  { name: 'fetchMarketStatus', run: () => fetchMarketStatus() },
  {
    name: 'fetchBalanceAdjustments',
    run: () =>
      fetchBalanceAdjustments({
        branchCode: '123',
        accountNumber: '1230001',
        customerName: 'x',
        ticker: 'AAPL',
        symbolName: 'x',
      }),
  },
  {
    name: 'createBalanceAdjustment',
    run: () =>
      createBalanceAdjustment({
        branchCode: '123',
        accountNumber: '1230001',
        symbolCode: 'AAPL',
        specificDeposit: '1',
        balance: 1,
      }),
  },
  {
    name: 'updateBalanceAdjustment',
    run: () => updateBalanceAdjustment({ id: '1', balance: 1, updatedAt: '' }),
  },
  {
    name: 'updateBalanceSellProhibited',
    run: () => updateBalanceSellProhibited({ id: '1', sellProhibited: true, updatedAt: '' }),
  },
  { name: 'fetchAnnouncement', run: () => fetchAnnouncement() },
  {
    name: 'updateAnnouncement',
    run: () => updateAnnouncement({ enabled: false, message: '', updatedAt: '' }),
  },
  {
    name: 'fetchAnnouncementHistory',
    run: () => fetchAnnouncementHistory({ limit: 10, offset: 0 }),
  },
  { name: 'fetchBanner', run: () => fetchBanner() },
  { name: 'fetchSuspensionStatus', run: () => fetchSuspensionStatus() },
  {
    name: 'fetchSuspensionHistories',
    run: () => fetchSuspensionHistories({ limit: 10, offset: 0 }),
  },
  {
    name: 'suspendOrders',
    run: () => suspendOrders({ target: '1', reason: 'x', updatedAt: null }),
  },
  { name: 'resumeOrders', run: () => resumeOrders({ target: '1', updatedAt: null }) },
  {
    name: 'fetchMizuhoExecutions',
    run: () =>
      fetchMizuhoExecutions({
        branchCode: '123',
        symbol: 'AAPL',
        side: '3',
        fillStatus: '011',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
      }),
  },
  { name: 'fetchMizuhoClosingStatus', run: () => fetchMizuhoClosingStatus() },
  { name: 'closeMizuhoOrders', run: () => closeMizuhoOrders() },
  { name: 'reopenMizuhoOrders', run: () => reopenMizuhoOrders() },
  // 応答は xlsx でスキーマが無いので、見るのはパスとクエリ名（side）だけ
  { name: 'exportMizuhoOrderSheet', run: () => exportMizuhoOrderSheet({ side: 'sell' }) },
  {
    name: 'fetchExecutions',
    run: () =>
      fetchExecutions({
        branchCode: '123',
        symbol: 'AAPL',
        side: 'buy',
        status: '011',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        route: '1',
      }),
  },
  {
    name: 'exportExecutionsCsv',
    run: () =>
      exportExecutionsCsv({
        branchCode: '123',
        symbol: 'AAPL',
        side: 'buy',
        status: '011',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        route: '1',
      }),
  },
  {
    name: 'fetchDreamOrders',
    run: () =>
      fetchDreamOrders({
        branchCode: '123',
        accountNumber: '123456',
        symbol: 'AAPL',
        status: 'ERROR',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        receiptNumber: 'DR-20260928-0002',
      }),
  },
  { name: 'fetchDreamStatusCodes', run: () => fetchDreamStatusCodes() },
  {
    name: 'changeDreamStatus',
    run: () => changeDreamStatus({ id: '56', status: '0', updatedAt: '' }),
  },
  { name: 'fetchOrderCsvSpec', run: () => fetchOrderCsvSpec() },
  { name: 'validateOrder', run: () => validateOrder(PROBE_ORDER) },
  { name: 'createOrder', run: () => createOrder(PROBE_ORDER) },
  { name: 'fetchOrderCsvTemplate', run: () => fetchOrderCsvTemplate() },
  {
    name: 'validateOrderCsv',
    // importConfirmationCsv と同じ回避（jsdom の FormData は MSW(node) が Request に変換できない）
    run: async () => {
      const form = await new Response('', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).formData()
      vi.stubGlobal('FormData', form.constructor)
      try {
        await validateOrderCsv(new NodeFile(['部店\r\n'], 'o.csv', { type: 'text/csv' }))
      } finally {
        vi.unstubAllGlobals()
      }
    },
  },
  { name: 'bulkCreateOrders', run: () => bulkCreateOrders([], { createdBy: '001' }) },
  {
    name: 'calculate',
    run: () =>
      calculate({
        accountNumber: '1230001',
        symbol: 'AAPL',
        side: '1',
        quantity: 10,
        unitPrice: 230.5,
        specificDeposit: '1',
        fxRate: null,
        localFee1: null,
        localFee2: null,
        localTax1: null,
        localTax2: null,
        localTax3: null,
        otherCost1: null,
        otherCost2: null,
        feePattern: null,
        feeMultiplier: null,
        basisPoints: null,
        taxExempt: false,
        feeMin: null,
        feeMax: null,
      }),
  },
]

/** 捕まえたリクエスト。{ probe, method, path, query: string[] } の配列 */
const captured = []

beforeAll(async () => {
  let current = null
  const listener = ({ request }) => {
    const url = new URL(request.url)
    const path = url.pathname.startsWith(BASE_PATH)
      ? url.pathname.slice(BASE_PATH.length)
      : url.pathname
    captured.push({
      probe: current,
      method: request.method.toUpperCase(),
      path,
      query: [...url.searchParams.keys()],
    })
  }

  server.events.on('request:start', listener)
  try {
    for (const probe of PROBES) {
      current = probe.name
      try {
        await probe.run()
      } catch {
        // 応答は見ない（404 / 409 / 422 でもリクエストの形は捕まえている）
      }
    }
  } finally {
    server.events.removeListener('request:start', listener)
  }
})

/* ---------- テスト ---------- */

describe('api の契約（openapi.json との突き合わせ）', () => {
  it('[CON-01] フィクスチャの各行は対応スキーマに無い項目を持たない', () => {
    const problems = FIXTURES.flatMap((f) =>
      unexpectedFixtureProblems(f).filter((p) => p.includes('仕様に無い項目')),
    )
    expect(problems).toEqual([])
  })

  it('[CON-02] フィクスチャの各行は対応スキーマの必須項目を欠かない', () => {
    const problems = FIXTURES.flatMap((f) =>
      unexpectedFixtureProblems(f).filter((p) => p.includes('必須項目')),
    )
    expect(problems).toEqual([])
  })

  it('[CON-03] フィクスチャの各項目の型は対応スキーマの宣言に合う', () => {
    const problems = FIXTURES.flatMap((f) =>
      unexpectedFixtureProblems(f).filter(
        (p) => !p.includes('仕様に無い項目') && !p.includes('必須項目'),
      ),
    )
    expect(problems).toEqual([])
  })

  it('[CON-04] src/api/ が送るパスとメソッドは仕様に存在する', () => {
    expect(captured.length, 'リクエストが 1 本も捕まえられていない').toBeGreaterThan(0)

    const problems = captured
      .filter((r) => !knownPathGap(r.method, r.path) && !findOperation(r.method, r.path))
      .map((r) => `${r.probe}: ${r.method} ${r.path} が openapi.json に無い`)
    expect(problems).toEqual([])
  })

  it('[CON-05] src/api/ が送るクエリ名は仕様の parameters に存在する', () => {
    const problems = captured.flatMap((r) => {
      const op = findOperation(r.method, r.path)
      if (!op) return []
      const known = new Set(op.parameters.filter((p) => p.in === 'query').map((p) => p.name))
      return r.query
        .filter((name) => !known.has(name) && !knownQueryGap(op, name))
        .map((name) => `${r.probe}: ${r.method} ${op.template} にクエリ "${name}" は無い`)
    })
    expect(problems).toEqual([])
  })

  it('[CON-06] integer のパスパラメータに整数以外や範囲外の値を送らない', () => {
    const problems = captured.flatMap((r) => {
      const op = findOperation(r.method, r.path)
      if (!op || op.paramNames.length === 0) return []
      const values = op.regex.exec(r.path).slice(1).map(decodeURIComponent)

      return op.paramNames.flatMap((name, i) => {
        const param = op.parameters.find((p) => p.in === 'path' && p.name === name)
        const schema = resolveRef(param?.schema)
        if (schema?.type !== 'integer') return []
        const value = values[i]
        const at = `${r.probe}: ${r.method} ${op.template} の {${name}}`
        if (!/^-?\d+$/.test(value)) return [`${at} は integer だが "${value}" を送っている`]
        const n = Number(value)
        if (schema.minimum !== undefined && n < schema.minimum)
          return [`${at} は ${schema.minimum} 以上だが ${n} を送っている`]
        if (schema.maximum !== undefined && n > schema.maximum)
          return [`${at} は ${schema.maximum} 以下だが ${n} を送っている`]
        return []
      })
    })
    expect(problems).toEqual([])
  })

  it('[CON-07] KNOWN_GAPS の食い違いはまだ解消していない（解消したら一覧から外す）', () => {
    const resolved = KNOWN_GAPS.flatMap((gap) => {
      const label = `${gap.kind} ${gap.request}`
      if (gap.kind === 'fixture') {
        const fixture = FIXTURES.find((f) => f.name === gap.fixture)
        if (!fixture) return [`${label}: フィクスチャ ${gap.fixture} が FIXTURES に無い`]
        if (gap.keys) {
          // 許している項目が仕様に入ったら、この行はもう要らない
          const properties = openapi.components.schemas[fixture.schema]?.properties ?? {}
          return gap.keys
            .filter((key) => key in properties)
            .map((key) => `${label}: ${fixture.schema} に "${key}" が入った（${gap.fixture}）`)
        }
        return fixtureProblems(fixture).length === 0
          ? [`${label}: ${gap.fixture} は ${fixture.schema} に合うようになった`]
          : []
      }
      if (gap.kind === 'path') {
        return findOperation(gap.method, gap.path)
          ? [`${label}: ${gap.method} ${gap.path} が仕様に入った`]
          : []
      }
      const op = findOperationByTemplate(gap.method, gap.template)
      if (!op)
        return [`${label}: ${gap.method} ${gap.template} が仕様に無い（テンプレートを見直す）`]
      const known = new Set(op.parameters.filter((p) => p.in === 'query').map((p) => p.name))
      return gap.names
        .filter((name) => known.has(name))
        .map((name) => `${label}: ${gap.method} ${gap.template} にクエリ "${name}" が入った`)
    })
    expect(resolved).toEqual([])
  })
})

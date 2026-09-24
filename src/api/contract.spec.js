import { beforeAll, describe, expect, it } from 'vitest'
import openapi from '../../docs/api/openapi.json'
import { server } from '../mocks/server'
import { canceledSymbols, symbols } from '../mocks/fixtures/symbols'
import { canceledCustomers, customers } from '../mocks/fixtures/customers'
import { canceledCorporateActions, corporateActions } from '../mocks/fixtures/ca'
import { blackoutDates, canceledBlackoutDates } from '../mocks/fixtures/blackoutDates'
import { canceledMarketHolidays, marketHolidays } from '../mocks/fixtures/marketHolidays'
import { sliceCriteriaSetting } from '../mocks/fixtures/sliceCriteria'
import { activityLogs } from '../mocks/fixtures/activityLogs'
import { activityLogTargets } from '../mocks/fixtures/activityLogTargets'
import { rolePermissions } from '../mocks/fixtures/permissions'
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
import { fetchOrders } from './orders'
import { fetchCodes } from './codes'
import { fetchCustomers } from './customers'
import {
  createCorporateAction,
  deleteCorporateAction,
  fetchCorporateActions,
  updateCorporateAction,
  validateCorporateAction,
} from './ca'
import { createSymbol, deleteSymbol, fetchSymbols, updateSymbol, validateSymbol } from './symbols'
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
import { fetchActivityLogTargets, fetchActivityLogs } from './activityLogs'
import { fetchStalledOrders } from './stalledOrders'
import { fetchPermissions } from './permissions'
import { fetchMarketStatus } from './marketStatus'
import {
  createBalanceAdjustment,
  fetchBalanceAdjustments,
  updateBalanceAdjustment,
} from './balanceAdjustments'
import {
  fetchAnnouncement,
  fetchAnnouncementHistory,
  updateAnnouncement,
} from './announcements'
import { fetchBanner } from './banner'

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
   * 操作ログは 2026-09-24 に ActivityLogItem の形へ張り替えた。残る 5 項目は画面モックにあった項目で、
   * フィクスチャに契約提案として載せている（src/api/activityLogs.js は読まない）。
   */
  {
    kind: 'fixture',
    fixture: 'activityLogs',
    keys: ['操作者名', '実行者区分', '対象機能', '操作内容', '結果'],
    reason:
      '画面モックにあった項目。ActivityLogItem に無いので画面には出さず、フィクスチャに契約提案として残している',
    request: '#1',
  },
  /*
   * 一覧の *Item が ID を返すようになった（2026-09-18 の取り込み）。フロントが先行して
   * 主キーを id に寄せていた間はここに keys: ['ID'] の行を置いていたが、仕様に入ったので外した。
   * 残っているのは更新系のパスキーで、そちらは型で検出できない（CON-06 のコメント）。
   */
  /*
   * パスは 2026-09-18 の取り込みで入った（GET / PUT / history）。ただし**形が全く違う**。
   * 仕様の RolePermissionItem は ID / ロールコード / ロール名 / 説明 / 発注権限 / マスタ更新権限 /
   * 運用管理権限 …（日本語キー・3 権限）で、フロントの実装は role / role_label / can_order /
   * can_master_update / can_order_stop / can_activity_log_view / can_admin_function（英語キー・5 権限）。
   * 画面モックを正として先に作った形なので、src/api/permissions.js と fixture と画面の列を
   * 仕様に合わせ直す作業が要る（docs/api/requests.md #4）。それまでここで食い違いを記録しておく。
   */
  {
    kind: 'fixture',
    fixture: 'permissions',
    reason:
      '権限マスタのパスは仕様に入ったが、フロントは画面モックの形（英語キー・5 権限）のまま。' +
      '仕様は日本語キー・3 権限（発注 / マスタ更新 / 運用管理）',
    request: '#4',
  },
  {
    kind: 'query',
    method: 'GET',
    template: '/masters/customers',
    names: ['handler_code', 'restriction', 'account_type', 'corporate_type'],
    reason: '画面モックにある検索条件。実 API は無視するので絞り込みが黙って効かない',
    request: '#8',
  },
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
   * 残高マスタの 2 つは画面モックにだけある項目で、src/api/balanceAdjustments.js の冒頭コメントの
   * 1 番（銘柄名の検索）と 4 番（売却不可区分）。MSW だけが解釈し、実 API は黙って無視する。
   */
  {
    kind: 'fixture',
    fixture: 'balanceAdjustments',
    keys: ['売却不可区分'],
    reason:
      '一覧の売却不可バッジと「売却を停止 / 売却停止を解除」の元になる項目が BalanceAdjustmentItem に無い。' +
      '更新側も BalanceAdjustmentUpdateRequest に無く、残高 が required なので売却可否だけの更新は 422 になる見込み',
    request: '#13',
  },
  {
    kind: 'query',
    method: 'GET',
    template: '/masters/balance-adjustments',
    names: ['symbol_name'],
    reason: '画面モックの「銘柄名」検索。実 API は無視するので絞り込みが黙って効かない',
    request: '#13',
  },
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
  { name: 'activityLogs', schema: 'ActivityLogItem', rows: activityLogs },
  { name: 'activityLogTargets', schema: 'ActivityLogTargetItem', rows: activityLogTargets },
  { name: 'permissions', schema: 'RolePermissionItem', rows: rolePermissions },
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
    case undefined:
      if (schema.properties) return objectProblems(value, schema, at)
      return typeof value === 'object' && value !== null ? [] : mismatch()
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

/**
 * src/api/ の関数を 1 つずつ呼び、MSW が捕まえたリクエストを控える。
 * 応答は見ない（404 / 409 / 422 で例外になっても、リクエストの形は既に出ている）。
 * 引数はすべての絞り込みを埋めて、送れるクエリを全部送らせる。
 */
const PROBES = [
  { name: 'fetchOrders', run: () => fetchOrders() },
  { name: 'fetchCodes', run: () => fetchCodes() },
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
      fetchSymbols({ symbolCode: 'AAPL', regulation: '0', orderRoute: '0', vwapTarget: '0' }),
  },
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
    name: 'fetchActivityLogs',
    run: () =>
      fetchActivityLogs({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        operator: '001',
        operation: 'UPDATE',
        targetType: 'customers',
        targetKey: 'x',
        sort: 'asc',
      }),
  },
  { name: 'fetchActivityLogTargets', run: () => fetchActivityLogTargets() },
  {
    name: 'fetchStalledOrders',
    run: () => fetchStalledOrders({ branchCode: '123', accountNumber: '1234567', symbol: 'AAPL' }),
  },
  { name: 'fetchPermissions', run: () => fetchPermissions() },
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
  { name: 'fetchAnnouncement', run: () => fetchAnnouncement() },
  {
    name: 'updateAnnouncement',
    run: () => updateAnnouncement({ enabled: false, message: '', updatedAt: '' }),
  },
  { name: 'fetchAnnouncementHistory', run: () => fetchAnnouncementHistory({ limit: 10, offset: 0 }) },
  { name: 'fetchBanner', run: () => fetchBanner() },
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

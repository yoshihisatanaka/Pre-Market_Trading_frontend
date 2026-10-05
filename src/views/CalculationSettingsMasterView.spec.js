import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { calculationSetting } from '@/mocks/fixtures/calculationSettings'
import { formatDateTime } from '@/utils/format'
import CalculationSettingsMasterView from './CalculationSettingsMasterView.vue'

/*
 * 画面テスト。実 Pinia + MSW(node) を通し、4 状態の出し分けと
 * 「比率 / bp ↔ %」の換算・入力欄の初期化・画面側の入力検証・保存の結果表示を検証する。
 *
 * この画面は URL クエリもルータも使わない（単一レコードで、閲覧のみの出し分けも無い）ので router は組まない。
 * Teleport も使っていないが、他の画面テストと同じく teleport を stub しておく。
 */
const PATH = '*/api/masters/calculation-settings'

// 期待値はフィクスチャから導く（0.00002 / 10 / 0.5 / 5 を直接書かない）
const RATE = calculationSetting['取引所税率']
const BP = calculationSetting['現地手数料率_bp']
const SPREAD = calculationSetting['為替スプレッド']
const NISA = calculationSetting['NISA為替上乗せ率']
const UPDATED_AT = calculationSetting['更新日時']
const UPDATED_BY = calculationSetting['更新者']

// 画面の単位。取引所税率は比率 × 100、現地手数料率は bp ÷ 100 で %。桁は画面モックの表記
const EXCHANGE_TEXT = (RATE * 100).toFixed(6)
const SPREAD_TEXT = SPREAD.toFixed(4)
const COMMISSION_TEXT = (BP / 100).toFixed(6)
const NISA_TEXT = NISA.toFixed(4)

// 保存に使う「現在値とは違う、有効な範囲の値」もフィクスチャから導く（既定モックで 0.003% / 0.15%）
const NEW_RATE = Number((RATE * 1.5).toFixed(10))
const NEW_BP = BP * 1.5
const NEW_EXCHANGE_TEXT = (NEW_RATE * 100).toFixed(6)
const NEW_COMMISSION_TEXT = (NEW_BP / 100).toFixed(6)

// 桁あふれ（スプレッドは小数第 4 位、現地手数料率は第 6 位まで）
const SPREAD_TOO_PRECISE = (SPREAD + 0.00001).toFixed(5)
const COMMISSION_TOO_PRECISE = (BP / 100 + 0.0000001).toFixed(7)
// モックが 422 で拒む値（NISA為替上乗せ率の上限は 100）
const INVALID_NISA = String(100 + 1)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const EMPTY_MESSAGE = '仮計算マスタが設定されていません。'
const SAVED_MESSAGE = '仮計算マスタを変更しました。'
const NO_CHANGE_MESSAGE = '変更はありません。'
const CONFLICT_MESSAGE =
  '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'
// 実 API の msg は項目名を含まないので、client.js が loc から項目名を補う
const INVALID_NISA_MESSAGE = 'NISA為替上乗せ率: 指定できる上限を超えています'

// 実 API のエラー本文は ErrorResponse（{ detail: string }）
const errorHandler = (options) =>
  http.get(PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
// 本文なし（204）。実 API では起きないが、画面の 4 状態を保つための空応答
const emptyHandler = () => http.get(PATH, () => new HttpResponse(null, { status: 204 }))
// 読み込んだ値が古い（サーバ側の更新日時はフィクスチャのまま）。保存で 409 になる
const staleHandler = () =>
  http.get(PATH, () => HttpResponse.json({ ...calculationSetting, 更新日時: '2000-01-01T00:00:00' }))

/**
 * PUT の本文を記録だけして、既定のハンドラへ素通しする（MSW は resolver が何も返さないと次へ進む）。
 * @returns {{ bodies: object[] }}
 */
function recordPut() {
  const recorded = { bodies: [] }
  server.use(
    http.put(PATH, async ({ request }) => {
      recorded.bodies.push(await request.clone().json())
    }),
  )
  return recorded
}

function mountView() {
  return mount(CalculationSettingsMasterView, {
    global: {
      plugins: [createPinia()],
      stubs: { teleport: true },
    },
  })
}

/** 取得 → 反映 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const text = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).text()
const inputValue = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).element.value
const setInput = async (wrapper, testid, value) => {
  await wrapper.find(`[data-testid="${testid}"]`).setValue(value)
}
/** 項目の下に出る入力エラー（FormField が role="alert" で出す） */
const fieldErrors = (wrapper) => wrapper.findAll('[role="alert"]').map((node) => node.text())
const submit = async (wrapper) => {
  await wrapper.find('[data-testid="calc-settings-form"]').trigger('submit')
  // PUT → 現在値の差し替え → 再描画 の分だけ待つ
  await settle()
}

// シナリオ: docs/unit/views-calculation-settings-master-view.md
describe('CalculationSettingsMasterView', () => {
  it('[PCV-01] 取得中はローディングを表示する', () => {
    // store.load() は setup 中に始まるので、最初の描画が既にローディング状態
    const wrapper = mountView()

    expect(exists(wrapper, 'calc-settings-loading')).toBe(true)
    expect(exists(wrapper, 'calc-settings-current')).toBe(false)
    expect(exists(wrapper, 'calc-settings-form')).toBe(false)
  })

  it('[PCV-02] 取得が失敗したときはメッセージと再試行ボタンを表示する', async () => {
    server.use(errorHandler())
    const wrapper = mountView()
    await settle()

    const error = wrapper.find('[data-testid="calc-settings-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'calc-settings-current')).toBe(false)
    expect(exists(wrapper, 'calc-settings-form')).toBe(false)
  })

  it('[PCV-03] 未設定のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const wrapper = mountView()
    await settle()

    expect(text(wrapper, 'calc-settings-empty')).toBe(EMPTY_MESSAGE)
    expect(exists(wrapper, 'calc-settings-current')).toBe(false)
    expect(exists(wrapper, 'calc-settings-form')).toBe(false)
  })

  it('[PCV-04] 取得成功時は現在値を % 換算で表示する', async () => {
    const wrapper = mountView()
    await settle()

    expect(text(wrapper, 'calc-settings-exchange-tax')).toBe(`${EXCHANGE_TEXT}%`)
    expect(text(wrapper, 'calc-settings-spread')).toBe(`${SPREAD_TEXT} 円/USD`)
    expect(text(wrapper, 'calc-settings-commission')).toBe(`${COMMISSION_TEXT}%`)
    expect(text(wrapper, 'calc-settings-nisa-markup')).toBe(`${NISA_TEXT}%`)
  })

  it('[PCV-05] 最終更新日時と更新者を表示する', async () => {
    const wrapper = mountView()
    await settle()

    const updated = text(wrapper, 'calc-settings-updated')
    expect(updated).toContain(`最終更新：${formatDateTime(UPDATED_AT)}`)
    expect(updated).toContain(`更新者：${UPDATED_BY}`)
  })

  it('[PCV-06] 入力欄が現在値の % 表記で初期化される', async () => {
    const wrapper = mountView()
    await settle()

    expect(inputValue(wrapper, 'calc-settings-exchange-tax-input')).toBe(EXCHANGE_TEXT)
    expect(inputValue(wrapper, 'calc-settings-spread-input')).toBe(SPREAD_TEXT)
    expect(inputValue(wrapper, 'calc-settings-commission-input')).toBe(COMMISSION_TEXT)
    expect(inputValue(wrapper, 'calc-settings-nisa-markup-input')).toBe(NISA_TEXT)
  })

  it('[PCV-07] 保存が成功するとサーバの文言が出て現在値が更新される', async () => {
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-exchange-tax-input', NEW_EXCHANGE_TEXT)
    await setInput(wrapper, 'calc-settings-commission-input', NEW_COMMISSION_TEXT)
    await submit(wrapper)

    expect(text(wrapper, 'calc-settings-notice')).toBe(SAVED_MESSAGE)
    expect(exists(wrapper, 'calc-settings-save-error')).toBe(false)
    expect(text(wrapper, 'calc-settings-exchange-tax')).toBe(`${NEW_EXCHANGE_TEXT}%`)
    expect(text(wrapper, 'calc-settings-commission')).toBe(`${NEW_COMMISSION_TEXT}%`)
  })

  it('[PCV-08] 保存時は % を比率と bp に戻して送る', async () => {
    const recorded = recordPut()
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-exchange-tax-input', NEW_EXCHANGE_TEXT)
    await setInput(wrapper, 'calc-settings-commission-input', NEW_COMMISSION_TEXT)
    await submit(wrapper)

    expect(recorded.bodies).toHaveLength(1)
    // 浮動小数の誤差（0.0030000000000000005 など）を載せず、列の精度に丸めた値で送る
    expect(recorded.bodies[0]).toMatchObject({
      取引所税率: NEW_RATE,
      現地手数料率_bp: NEW_BP,
      為替スプレッド: SPREAD,
      NISA為替上乗せ率: NISA,
    })
  })

  it('[PCV-09] 何も変えずに保存すると「変更はありません。」が出る', async () => {
    const wrapper = mountView()
    await settle()

    await submit(wrapper)

    expect(text(wrapper, 'calc-settings-notice')).toBe(NO_CHANGE_MESSAGE)
    expect(exists(wrapper, 'calc-settings-save-error')).toBe(false)
  })

  it('[PCV-10] 空欄で保存すると項目の下に理由が出て送らない', async () => {
    const recorded = recordPut()
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-exchange-tax-input', '')
    await submit(wrapper)

    expect(fieldErrors(wrapper)).toContain('取引所税を入力してください。')
    expect(recorded.bodies).toHaveLength(0)
    expect(exists(wrapper, 'calc-settings-notice')).toBe(false)
  })

  it('[PCV-11] スプレッドが小数第 4 位を超えると理由が出て送らない', async () => {
    const recorded = recordPut()
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-spread-input', SPREAD_TOO_PRECISE)
    await submit(wrapper)

    expect(fieldErrors(wrapper)).toContain('スプレッドは小数第4位までで入力してください。')
    expect(recorded.bodies).toHaveLength(0)
    expect(exists(wrapper, 'calc-settings-notice')).toBe(false)
  })

  it('[PCV-12] 現地手数料率が小数第 6 位を超えると理由が出て送らない', async () => {
    const recorded = recordPut()
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-commission-input', COMMISSION_TOO_PRECISE)
    await submit(wrapper)

    expect(fieldErrors(wrapper)).toContain('現地手数料率は小数第6位までで入力してください。')
    expect(recorded.bodies).toHaveLength(0)
    expect(exists(wrapper, 'calc-settings-notice')).toBe(false)
  })

  it('[PCV-13] 範囲外の NISA為替上乗せ率で保存すると理由が出て現在値は変わらない', async () => {
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-nisa-markup-input', INVALID_NISA)
    await submit(wrapper)

    expect(text(wrapper, 'calc-settings-save-error')).toContain(INVALID_NISA_MESSAGE)
    expect(exists(wrapper, 'calc-settings-notice')).toBe(false)
    expect(text(wrapper, 'calc-settings-nisa-markup')).toBe(`${NISA_TEXT}%`)
  })

  it('[PCV-14] 他の担当者が先に更新していると競合の理由が出て現在値は変わらない', async () => {
    server.use(staleHandler())
    const wrapper = mountView()
    await settle()

    await setInput(wrapper, 'calc-settings-exchange-tax-input', NEW_EXCHANGE_TEXT)
    await submit(wrapper)

    expect(text(wrapper, 'calc-settings-save-error')).toBe(CONFLICT_MESSAGE)
    expect(exists(wrapper, 'calc-settings-notice')).toBe(false)
    expect(text(wrapper, 'calc-settings-exchange-tax')).toBe(`${EXCHANGE_TEXT}%`)
  })

  it('[PCV-15] 「再試行」で取り直すとエラーが消えて現在値が出る', async () => {
    // 2 回目は既定ハンドラ（フィクスチャ）に戻る
    server.use(errorHandler({ once: true }))
    const wrapper = mountView()
    await settle()
    expect(exists(wrapper, 'calc-settings-error')).toBe(true)

    await wrapper.find('[data-testid="calc-settings-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'calc-settings-error')).toBe(false)
    expect(text(wrapper, 'calc-settings-exchange-tax')).toBe(`${EXCHANGE_TEXT}%`)
  })
})

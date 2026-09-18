import { HttpResponse } from 'msw'

/*
 * 各マスタのモックが共用するヘルパ。実 API（FastAPI）の応答の形をそろえるためのもので、
 * 画面のロジックはここに置かない。ハンドラ本体は画面ごとのファイル（symbols.js など）にある。
 */

/** サーバが決める更新日時。バックエンドが返すのと同じ 'YYYY-MM-DD HH:MM:SS' 形式 */
export function nowTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * サーバが決める日時。実 API が datetime を返すときの形（'2026-09-11T10:00:00'）。
 * nowTimestamp と違って T 区切りなのは、FastAPI が datetime を ISO で直列化するため。
 */
export function nowIsoTimestamp() {
  return new Date().toISOString().slice(0, 19)
}

export function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * 実 API の ErrorResponse（`{ detail: string }`）と同じ形で返す。
 * 実 API 側は共通のモデルなので、マスタごとに分けず 1 つで使う。
 */
export function detailError(status, detail) {
  return HttpResponse.json({ detail }, { status })
}

/**
 * FastAPI の 422（HTTPValidationError）と同じ形で返す。
 * 本文のスキーマ（pydantic）で弾かれるものはサービス層の検証へ進まず、この形になる。
 */
export function requestValidationError(loc, msg, type) {
  return HttpResponse.json({ detail: [{ loc, msg, type }] }, { status: 422 })
}

/** YYYYMMDD の integer が実在する日か（範囲は見ない） */
export function isRealYmd(value) {
  const year = Math.floor(value / 10000)
  const month = Math.floor(value / 100) % 100
  const day = value % 100
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * 楽観的ロックの合札を照合する。
 *
 * 実 API は T と半角空白の差を吸収し、どちらかがもう一方の先頭に一致すれば同じ値と見なす
 * （秒未満の桁が付くかどうかがクライアントによって違うため）。
 * 合札を送っていない（null）ときと、サーバ側に更新日時が無いときは照合しない。
 */
export function isSameTimestamp(provided, current) {
  if (provided === null || current === null || current === undefined) return true

  const normalizedProvided = String(provided).replace('T', ' ')
  const normalizedCurrent = String(current).replace('T', ' ')

  return (
    normalizedProvided.startsWith(normalizedCurrent) ||
    normalizedCurrent.startsWith(normalizedProvided)
  )
}

/*
 * 全画面ヘッダ用バナー（GET /operations/banner）が返す生の形。
 * キーは openapi.json の BannerResponse のまま日本語。
 *
 * 種別ごとに 1 つずつ置く。既定のハンドラはお知らせの現在値から NOTICE / NONE を組み立てるので、
 * ここの値は単体テストの server.use() と E2E の mockApi() で差し替えるときに使う。
 * 発注停止（INCIDENT）は障害管理が持つ状態で、お知らせ管理の操作では作れない。
 */

/** 発注停止中。障害メッセージが優先され、お知らせは表示中でもバナーに出ない */
export const incidentBannerResponse = {
  種別: 'INCIDENT',
  重要度: 'critical',
  メッセージ: 'システム障害のため、全注文の発注を停止しています。',
  発注停止中: true,
  停止中の対象: ['ALL'],
  停止中の対象名: ['全注文'],
  // 停止中でもお知らせの生の状態は返る（description の約束）
  お知らせ表示中: true,
  お知らせ本文: '9月27日 06:00〜07:00 に計画メンテナンスを予定しています。',
}

/** 通常運用でお知らせ表示中 */
export const noticeBannerResponse = {
  種別: 'NOTICE',
  重要度: 'info',
  メッセージ: '9月27日 06:00〜07:00 に計画メンテナンスを予定しています。',
  発注停止中: false,
  停止中の対象: [],
  停止中の対象名: [],
  お知らせ表示中: true,
  お知らせ本文: '9月27日 06:00〜07:00 に計画メンテナンスを予定しています。',
}

/** 通常運用でお知らせも出していない */
export const noneBannerResponse = {
  種別: 'NONE',
  重要度: 'normal',
  メッセージ: null,
  発注停止中: false,
  停止中の対象: [],
  停止中の対象名: [],
  お知らせ表示中: false,
  お知らせ本文: null,
}

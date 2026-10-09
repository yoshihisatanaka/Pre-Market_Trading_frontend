import { apiClient } from './client'

/*
 * 全画面ヘッダ用バナー（実 API `GET /operations/banner`・タグ Announcements）。
 *
 * 発注停止（障害管理）とお知らせを**サーバが 1 回で統合判定**して返す。
 *   INCIDENT … いずれかの停止対象が発注停止中。障害メッセージを出し、お知らせは出さない
 *   NOTICE   … 通常運用でお知らせ表示中。お知らせ本文を出す
 *   NONE     … どちらも無い
 * 優先順位の判定はサーバの仕事なので、画面は kind を見るだけにして組み立て直さない。
 *
 * 利用者はヘッダ直下の帯（components/layout/AppOperationBanner）とお知らせ管理（現在の運用状態）。
 * どちらからも使えるよう画面固有の加工はしない。
 */

/**
 * @typedef {{
 *   kind: string,
 *   severity: string,
 *   message: string,
 *   ordersSuspended: boolean,
 *   suspendedTargets: string[],
 *   suspendedTargetNames: string[],
 *   announcementVisible: boolean,
 *   announcementMessage: string,
 * }} Banner
 *   kind は INCIDENT / NOTICE / NONE、severity は critical / info / normal（いずれも enum 宣言の無い素の string）。
 *   announcementVisible は発注停止中でもお知らせの生の状態を表す（バナーに出るかどうかではない）
 */

/**
 * バナーの表示内容を取得する。
 *
 * @returns {Promise<Banner>}
 */
export async function fetchBanner() {
  const { data } = await apiClient.get('/operations/banner')
  return toBanner(data)
}

/** BannerResponse → アプリ内モデル */
function toBanner(raw) {
  return {
    kind: raw?.['種別'] ?? 'NONE',
    severity: raw?.['重要度'] ?? 'normal',
    // NONE のとき null。表示側で null を出さないよう空文字に寄せる
    message: raw?.['メッセージ'] ?? '',
    ordersSuspended: Boolean(raw?.['発注停止中']),
    suspendedTargets: raw?.['停止中の対象'] ?? [],
    suspendedTargetNames: raw?.['停止中の対象名'] ?? [],
    announcementVisible: Boolean(raw?.['お知らせ表示中']),
    announcementMessage: raw?.['お知らせ本文'] ?? '',
  }
}

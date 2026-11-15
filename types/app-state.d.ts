interface Window {
  /** E2E や手動検証から再生設定を切り替えるための console API。 */
  knkPlaybackSettings?: import("../app/controllers/playback-settings.mjs").PlaybackSettingsConsoleApi;
  /** YouTube 再生制御のデバッグログを一時的に有効化するフラグ。 */
  __KNK_DEBUG_YOUTUBE__?: boolean;
  /** 自動再生開始判定の fallback を検証時だけ有効化するフラグ。 */
  __KNK_AUTOPLAY_START_FALLBACK__?: boolean;
  /** YouTube IFrame API が window に公開する namespace。 */
  YT: import("../app/lib/youtube/iframe-api.types.mjs").YoutubeIframeApiGlobal;
  /** YouTube IFrame API の読み込み完了 callback。 */
  onYouTubeIframeAPIReady?: () => void;
}

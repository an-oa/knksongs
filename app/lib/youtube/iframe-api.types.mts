/**
 * YouTube IFrame API の Player として利用する最小限のメソッド。
 * 個別メソッドは外部 API 名をそのまま写すため、型全体の説明に集約する。
 */
export type YoutubePlayerLike = {
  getIframe?: () => Element | null;
  getPlayerState?: () => number;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  stopVideo?: () => void;
  destroy?: () => void;
};

/**
 * YouTube IFrame API 境界で受け取る状態変更・エラーイベント。
 * 部分的な通知を受ける既存の処理に合わせ、各プロパティは省略を許容する。
 */
export type YoutubePlayerEvent = {
  data?: number;
  target?: YoutubePlayerLike;
};

/**
 * YouTube IFrame API が window に公開する namespace。
 * 個別プロパティは外部 API の公開名を写すため、型全体の説明に集約する。
 */
export type YoutubeIframeApiGlobal = {
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
  Player: new (
    iframe: Element,
    options: {
      host?: string;
      events?: {
        onReady?: (event: Pick<YoutubePlayerEvent, "target">) => void;
        onStateChange?: (event: YoutubePlayerEvent) => void;
        onError?: (event: YoutubePlayerEvent) => void;
      };
    }
  ) => YoutubePlayerLike;
};

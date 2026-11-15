import assert from "node:assert/strict";
import type { YoutubeIframeApiGlobal, YoutubePlayerLike } from "../../app/lib/youtube/iframe-api.types.mts";
import { YOUTUBE_PLAYER_STATE } from "../../app/lib/youtube/player-state.mts";

/** Playerごとに状態とイベント通知先を保持する。現在状態と通知値は独立して指定できる。 */
export function createYoutubeIframeApiFixture(input: {
    readPlayerState?: boolean;
    initialState?: number;
    currentTime?: number;
    duration?: number;
} = {}) {
    const creations: {
        iframe: Element;
        player: FixturePlayer;
        emitReady: () => void;
        emitStateChange: (state: number) => void;
        emitError: (code: number) => void;
        options: ConstructorParameters<YoutubeIframeApiGlobal["Player"]>[1];
    }[] = [];

    class FixturePlayer implements YoutubePlayerLike {
        private iframe: Element;
        currentState = input.initialState ?? YOUTUBE_PLAYER_STATE.UNSTARTED;
        currentTime = input.currentTime ?? 0;
        duration = input.duration ?? 0;
        stopCalls = 0;
        destroyCalls = 0;
        loadCalls: unknown[] = [];
        // 状態読取りなしのAPI境界も検証するため、必要なテストだけで公開する。
        getPlayerState = input.readPlayerState ? () => this.currentState : undefined;

        /** 生成を記録する。readyや状態変化はテスト側から明示的に通知する。 */
        constructor(iframe: Element, options: ConstructorParameters<YoutubeIframeApiGlobal["Player"]>[1]) {
            this.iframe = iframe;
            creations.push({
                iframe,
                options,
                player: this,
                /** このPlayerの読み込み完了を通知する。 */
                emitReady: () => {
                    assert.ok(options.events?.onReady);
                    options.events.onReady({ target: this });
                },
                /** 現在状態を書き換えず、このPlayerに紐づく状態イベントを通知する。 */
                emitStateChange: (data) => {
                    assert.ok(options.events?.onStateChange);
                    options.events.onStateChange({ data, target: this });
                },
                /** 破棄後も含め、このPlayerに紐づくエラーを通知する。 */
                emitError: (data) => {
                    assert.ok(options.events?.onError);
                    options.events.onError({ data, target: this });
                }
            });
        }

        /** 紐付けられたiframeを返す。 */
        getIframe() { return this.iframe; }
        /** テストで指定した現在位置を返す。 */
        getCurrentTime() { return this.currentTime; }
        /** テストで指定した動画の長さを返す。 */
        getDuration() { return this.duration; }
        /** 停止要求を記録する。 */
        stopVideo() { this.stopCalls += 1; }
        /** iframe再生成の代わりに既存Playerを再利用していないか検証する。 */
        loadVideoById(args: unknown) { this.loadCalls.push(args); }
        /** 破棄要求を記録し、遅れて届くイベントの通知先は保持する。 */
        destroy() { this.destroyCalls += 1; }
    }

    const api: YoutubeIframeApiGlobal = {
        PlayerState: YOUTUBE_PLAYER_STATE,
        Player: FixturePlayer
    };
    return { api, creations };
}

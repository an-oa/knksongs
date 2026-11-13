import type {
    YoutubeIframeApiGlobal,
    YoutubePlayerLike
} from "../../../app/lib/youtube/iframe-api.types.mts";

export type MockVideoBehavior = "manual" | "auto-playing" | "auto-error" | "auto-ended";

/** ブラウザ側のPlayerをE2Eから操作・観測するためのAPI。 */
export type MockYoutubeControls = {
    setBehavior: (videoId: string, behavior: MockVideoBehavior) => void;
    emit: (index: number, state: number) => void;
    error: (index: number, code: number) => void;
    latestIndex: () => number;
    latestVideoId: () => string;
    playerCount: () => number;
};

const players: MockPlayer[] = [];
const behaviorMap = new Map<string, MockVideoBehavior>();
const playerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

/** iframeの埋め込みURLから動画IDを読む。 */
function getVideoIdFromIframe(iframe: HTMLIFrameElement): string {
    try {
        const url = new URL(iframe.src, window.location.href);
        const parts = url.pathname.split("/");
        return parts[parts.length - 1] || "";
    } catch {
        return "";
    }
}

/** 読み込み完了・状態変更・エラーを通知できるE2E用Player。 */
class MockPlayer implements YoutubePlayerLike {
    readonly iframe: HTMLIFrameElement;
    readonly videoId: string;
    readonly options: ConstructorParameters<YoutubeIframeApiGlobal["Player"]>[1];
    state = playerState.UNSTARTED;

    /** Playerを登録し、readyと動画ごとの自動通知を非同期に送る。 */
    constructor(host: Element, options: ConstructorParameters<YoutubeIframeApiGlobal["Player"]>[1] = {}) {
        this.options = options;
        this.iframe = host instanceof HTMLIFrameElement ? host : document.createElement("iframe");
        if (this.iframe !== host) host.appendChild(this.iframe);
        this.videoId = getVideoIdFromIframe(this.iframe);
        players.push(this);
        const onReady = options.events?.onReady;
        if (onReady) Promise.resolve().then(() => onReady({ target: this }));
        const behavior = behaviorMap.get(this.videoId) || "manual";
        if (behavior === "auto-playing") {
            setTimeout(() => this.emitStateChange(playerState.PLAYING), 0);
        } else if (behavior === "auto-error") {
            setTimeout(() => this.emitError(150), 0);
        } else if (behavior === "auto-ended") {
            setTimeout(() => this.emitStateChange(playerState.ENDED), 0);
        }
    }

    /** プレーヤーの表示先を返す。 */
    getIframe(): HTMLIFrameElement { return this.iframe; }

    /** 現在の再生状態を返す。 */
    getPlayerState(): number { return this.state; }

    /** 再生を停止状態へ変更する。 */
    stopVideo(): void { this.state = playerState.PAUSED; }

    /** iframeの削除はアプリ側で扱うため、モックでは追加処理しない。 */
    destroy(): void {}

    /** 再生状態を更新し、このPlayerのリスナーへ通知する。 */
    emitStateChange(state: number): void {
        this.state = state;
        this.options.events?.onStateChange?.({ data: state, target: this });
    }

    /** このPlayerのエラーリスナーへ通知する。 */
    emitError(code: number): void {
        this.options.events?.onError?.({ data: code, target: this });
    }
}

window.YT = { PlayerState: playerState, Player: MockPlayer };
window.__knkMockYoutube = {
    /** 次に生成する対象動画のPlayerのふるまいを設定する。 */
    setBehavior(videoId, behavior) { behaviorMap.set(videoId, behavior); },
    /** 生成順で指定したPlayerから状態変更を通知する。 */
    emit(index, state) { players[index]?.emitStateChange(state); },
    /** 生成順で指定したPlayerからエラーを通知する。 */
    error(index, code) { players[index]?.emitError(code); },
    /** 最後に生成したPlayerの添字を返す。 */
    latestIndex() { return players.length - 1; },
    /** 最後に生成したPlayerの動画IDを返す。 */
    latestVideoId() { return players[players.length - 1]?.videoId || ""; },
    /** これまでに生成したPlayerの数を返す。 */
    playerCount() { return players.length; }
};
window.onYouTubeIframeAPIReady?.();

import type { YoutubePlayerLike } from "./iframe-api.types.mjs";

export const YOUTUBE_PLAYER_STATE = Object.freeze({
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
});

/**
 * YouTube Player の現在 state を安全に読み取る。
 * @param {YoutubePlayerLike | null | undefined} player
 * @returns {number | null}
 */
export function readYoutubePlayerState(player: YoutubePlayerLike | null | undefined): number | null {
    if (!player || typeof player.getPlayerState !== "function") return null;
    try {
        const state = player.getPlayerState();
        return Number.isFinite(state) ? state : null;
    } catch {
        return null;
    }
}

/**
 * YouTube Player の現在再生位置を安全に読み取る。
 * @param {YoutubePlayerLike | null | undefined} player
 * @returns {number | null}
 */
export function readYoutubePlayerCurrentTime(player: YoutubePlayerLike | null | undefined): number | null {
    if (!player || typeof player.getCurrentTime !== "function") return null;
    try {
        const currentTime = player.getCurrentTime();
        return Number.isFinite(currentTime) ? currentTime : null;
    } catch {
        return null;
    }
}

/**
 * YouTube Player の動画尺を安全に読み取る。
 * @param {YoutubePlayerLike | null | undefined} player
 * @returns {number | null}
 */
export function readYoutubePlayerDuration(player: YoutubePlayerLike | null | undefined): number | null {
    if (!player || typeof player.getDuration !== "function") return null;
    try {
        const duration = player.getDuration();
        return Number.isFinite(duration) ? duration : null;
    } catch {
        return null;
    }
}

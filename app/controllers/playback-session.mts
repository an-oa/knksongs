/**
 * 「終了後、次の曲を再生」と「リピート再生」の設定に従って、次の曲へ進める controller。
 *
 * 再生が終わったときや再生開始に失敗したときに、bootstrap.mts が配線した hook から呼ばれる。
 * 現在の検索結果と設定から次の候補を並べ (../lib/playback-sequence)、開始できなかった候補は飛ばす。
 * 開始が未確定のときや、別の再生に切り替わったときは進めずに止まる。
 * 再生と追従スクロールの実処理は callbacks 経由で render controller に任せる。
 *
 * 設定の値の管理は ./playback-settings.mts、プレーヤーの制御は ./youtube.mts が担当する。
 */
import { getPlaybackContinuationCandidates } from "../lib/playback-sequence.mjs";
import { debugPlayback } from "../lib/playback-debug.mjs";
import {
    isYoutubePlaybackStarted,
    isYoutubePlaybackStartUnconfirmed
} from "../lib/youtube/playback-start-attempt.mjs";
import type { YoutubePlaybackStartResult } from "../lib/youtube/playback-start-attempt.mjs";
import type { AppDataState, AppUiState } from "../state.types";

type PlaybackSessionCallbacks = {
    playSongByKey: (songKey: string) => Promise<YoutubePlaybackStartResult> | YoutubePlaybackStartResult;
    scrollSongIntoView: (songKey: string) => void;
};

type PlaybackSessionControllerInput = {
    data: Pick<AppDataState, "currentResults">;
    ui: {
        playback: Pick<AppUiState["playback"], "continuousPlayback" | "loopPlayback" | "activeThumb">;
    };
    callbacks: PlaybackSessionCallbacks;
};

/**
 * 再生終了後の継続再生と追従スクロールを制御する。
 * @param {PlaybackSessionControllerInput} input
 */
export function createPlaybackSessionController({ data, ui, callbacks }: PlaybackSessionControllerInput) {
    const playbackUi = ui.playback;
    const playSongByKey = callbacks.playSongByKey;
    const scrollSongIntoView = callbacks.scrollSongIntoView;

    /**
     * 現在の再生設定に従い、終了した曲の次候補を順に再生する。
     * @param {string} finishedSongKey
     * @returns {Promise<boolean>}
     */
    async function continuePlayback(finishedSongKey: string): Promise<boolean> {
        const candidates = getPlaybackContinuationCandidates(
            data.currentResults,
            finishedSongKey,
            {
                continuousPlayback: playbackUi.continuousPlayback,
                loopPlayback: playbackUi.loopPlayback
            }
        );
        debugPlayback("playback-session", "continuePlayback candidates", {
            finishedSongKey,
            candidates,
            continuousPlayback: playbackUi.continuousPlayback,
            loopPlayback: playbackUi.loopPlayback
        });
        for (const songKey of candidates) {
            const playbackResult = await Promise.resolve(playSongByKey(songKey));
            const didStartPlayback = isYoutubePlaybackStarted(playbackResult);
            const isStartUnconfirmed = isYoutubePlaybackStartUnconfirmed(playbackResult);
            const wasPlaybackTakenOver = Boolean(playbackUi.activeThumb);
            debugPlayback("playback-session", "continuePlayback playSongByKey result", {
                finishedSongKey,
                candidateSongKey: songKey,
                playbackResult,
                hasActiveThumb: wasPlaybackTakenOver
            });
            if (
                didStartPlayback ||
                isStartUnconfirmed ||
                !wasPlaybackTakenOver
            ) {
                scrollSongIntoView(songKey);
            }
            if (didStartPlayback) {
                debugPlayback("playback-session", "continuePlayback advanced", {
                    finishedSongKey,
                    nextSongKey: songKey
                });
                return true;
            }
            if (isStartUnconfirmed) {
                debugPlayback("playback-session", "continuePlayback stopped because playback start is unconfirmed", {
                    finishedSongKey,
                    candidateSongKey: songKey
                });
                return false;
            }
            if (wasPlaybackTakenOver) {
                debugPlayback("playback-session", "continuePlayback stopped because playback was taken over", {
                    finishedSongKey,
                    candidateSongKey: songKey
                });
                return false;
            }
        }
        debugPlayback("playback-session", "continuePlayback exhausted candidates", {
            finishedSongKey
        });
        return false;
    }

    return {
        continuePlayback
    };
}

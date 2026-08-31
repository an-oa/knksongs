/**
 * 現在のJSONスキーマを満たす曲テストデータを作る。
 * @param {Partial<Song>} [overrides] 上書きするフィールド
 * @returns {Song}
 */
export function createSongFixture(overrides = {}) {
    return {
        date: "2026/03/11",
        dateKey: 20260311,
        archiveId: "archive-1",
        archiveOrder: 1,
        videoId: "abc123def45",
        songKey: "archive-1::1",
        bookmarkSongKey: "abc123def45::1",
        legacySongKey: "archive-1::1::https://www.youtube.com/watch?v=abc123def45&t=10s",
        format: "配信",
        streamRole: "",
        videoOrientation: "vertical",
        isRelay: false,
        isHarmony: false,
        title: "KING",
        artist: "Kanaria feat. GUMI",
        titleYomi: "キング",
        artistYomi: "カナリアフィーチャリンググミ",
        url: "https://www.youtube.com/watch?v=abc123def45&t=10s",
        endSeconds: 581,
        titleNorm: "king",
        artistNorm: "kanaria feat. gumi",
        titleYomiNorm: "キング",
        artistYomiNorm: "カナリアフィーチャリンググミ",
        ...overrides
    };
}

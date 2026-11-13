/**
 * 現在のJSONスキーマを満たす曲テストデータを作る。
 * @param overrides 上書きするフィールド
 */
export function createSongFixture(overrides: Partial<Song> = {}): Song {
    return {
        date: "2026/03/11",
        dateKey: 20260311,
        archiveId: "archive-1",
        archiveOrder: 1,
        videoId: "abc123def45",
        songKey: "abc123def45::1",
        format: "配信",
        streamRole: "",
        videoOrientation: "vertical",
        isRelay: false,
        isHarmony: false,
        title: "KING",
        artist: "Kanaria feat. GUMI",
        titleYomi: "キング",
        artistYomi: "カナリアフィーチャリンググミ",
        titleEn: "KING",
        artistEn: "Kanaria feat. GUMI",
        url: "https://www.youtube.com/watch?v=abc123def45&t=10s",
        endSeconds: 581,
        titleNorm: "king",
        artistNorm: "kanaria feat. gumi",
        titleYomiNorm: "キング",
        artistYomiNorm: "カナリアフィーチャリンググミ",
        titleEnNorm: "king",
        artistEnNorm: "kanaria feat. gumi",
        artistSortNorm: "kanaria feat. gumi",
        ...overrides
    };
}

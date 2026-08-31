/**
 * スクロールを伴う検索結果のE2E検証用に曲fixtureを作る。
 * @param {number} count
 * @returns {Song[]}
 */
export function createScrollableResultSongs(count) {
    return Array.from({ length: count }, (_, index) => {
        const songNumber = index + 1;
        const paddedIndex = String(songNumber).padStart(2, "0");
        const month = 2 + Math.floor(index / 28);
        const day = (index % 28) + 1;
        const date = `2024/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
        const videoId = `scroll-video-${paddedIndex}`;
        const title = `Scroll Song ${paddedIndex}`;
        const artist = "Scroll Artist";
        return {
            date,
            dateKey: 20240000 + (month * 100) + day,
            archiveId: `scroll-archive-${paddedIndex}`,
            archiveOrder: 1,
            videoId,
            songKey: `scroll-archive-${paddedIndex}::1`,
            bookmarkSongKey: `${videoId}::1`,
            legacySongKey: `scroll-archive-${paddedIndex}::1::https://www.youtube.com/watch?v=${videoId}&t=${songNumber}s`,
            format: "配信",
            streamRole: "",
            videoOrientation: "",
            isRelay: false,
            isHarmony: false,
            title,
            artist,
            titleYomi: title,
            artistYomi: artist,
            url: `https://www.youtube.com/watch?v=${videoId}&t=${songNumber}s`,
            endSeconds: null,
            titleNorm: title.toLowerCase(),
            artistNorm: artist.toLowerCase(),
            titleYomiNorm: title.toLowerCase(),
            artistYomiNorm: artist.toLowerCase()
        };
    });
}

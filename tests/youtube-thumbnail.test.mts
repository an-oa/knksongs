import test from "node:test";
import assert from "node:assert/strict";
import {
    applyYoutubeThumbnailImage,
    clearYoutubeThumbnailPlaybackTarget,
    createYoutubeThumbnailImage,
    createYoutubeThumbnailPlayButton,
    getSongKeyFromYoutubeThumb,
    getYoutubeThumbnailIdleRenderKey,
    getYoutubeThumbnailPlayButton,
    getYoutubeThumbnailPlayLabel,
    getYoutubeThumbnailPlaybackEndSeconds,
    getYoutubeThumbnailPlaybackMode,
    getYoutubeThumbnailPlaybackSessionId,
    preventYoutubeThumbnailDefaultAction,
    setYoutubeThumbnailExpandedCardState,
    setYoutubeThumbnailIdleRenderKey,
    setYoutubeThumbnailOrientation,
    setYoutubeThumbnailPlayLabel,
    setYoutubeThumbnailPlaybackMode,
    setYoutubeThumbnailPlaybackSessionId,
    setYoutubeThumbnailPlaybackState,
    setYoutubeThumbnailPlaybackTarget,
    suppressYoutubeThumbnailContextMenu
} from "../app/lib/youtube/thumbnail.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";

test("youtube thumbnail: create/apply image sets the mqdefault source with native lazy loading", () => {
    const cleanup = installFakeDom();
    try {
        const thumb = document.createElement("div");
        const created = createYoutubeThumbnailImage("video1");
        assert.ok(created);
        assert.equal(created.loading, "lazy");
        assert.equal(created.src, "https://i.ytimg.com/vi/video1/mqdefault.jpg");

        applyYoutubeThumbnailImage(thumb, "video1");
        const img = thumb.querySelector("img");
        assert.ok(img);
        assert.equal(img.loading, "lazy");
        assert.equal(img.src, "https://i.ytimg.com/vi/video1/mqdefault.jpg");
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: the image sits inside a labelled play button", () => {
    const cleanup = installFakeDom();
    try {
        const button = createYoutubeThumbnailPlayButton("video1", "「Song A」を再生");
        assert.ok(button);
        assert.equal(button.tagName, "BUTTON");
        assert.equal(button.type, "button");
        assert.equal(button.classList.contains("thumb-play-btn"), true);
        assert.equal(button.getAttribute("aria-label"), "「Song A」を再生");
        const img = button.querySelector("img");
        assert.ok(img);
        assert.equal(img.alt, "", "the button label names the song, so the image is decorative");
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: the play label is kept on the thumbnail and reused when the button is rebuilt", () => {
    const cleanup = installFakeDom();
    try {
        const thumb = document.createElement("div");
        assert.equal(getYoutubeThumbnailPlayLabel(thumb), "");
        assert.equal(getYoutubeThumbnailPlayButton(thumb), null);

        // ボタンを置く前に保存した説明は、後から置くボタンに付く。
        setYoutubeThumbnailPlayLabel(thumb, "「Song A」を再生");
        applyYoutubeThumbnailImage(thumb, "video1");
        const first = getYoutubeThumbnailPlayButton(thumb);
        assert.ok(first);
        assert.equal(first.getAttribute("aria-label"), "「Song A」を再生");

        // 表示中のボタンは、説明を変えるとその場で書き換わる。
        setYoutubeThumbnailPlayLabel(thumb, "Play “Song A”");
        assert.equal(first.getAttribute("aria-label"), "Play “Song A”");

        // 再生を閉じて作り直したボタンにも、保存してある説明が付く。
        applyYoutubeThumbnailImage(thumb, "video1");
        const rebuilt = getYoutubeThumbnailPlayButton(thumb);
        assert.ok(rebuilt);
        assert.notEqual(rebuilt, first);
        assert.equal(rebuilt.getAttribute("aria-label"), "Play “Song A”");
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: the idle render key can be stored and cleared", () => {
    const cleanup = installFakeDom();
    try {
        const thumb = document.createElement("div");
        assert.equal(getYoutubeThumbnailIdleRenderKey(thumb), "");
        setYoutubeThumbnailIdleRenderKey(thumb, "shown|video1");
        assert.equal(getYoutubeThumbnailIdleRenderKey(thumb), "shown|video1");
        setYoutubeThumbnailIdleRenderKey(thumb, "");
        assert.equal(getYoutubeThumbnailIdleRenderKey(thumb), "");
        assert.equal("thumbnailRenderKey" in thumb.dataset, false);
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: save-related default actions are suppressed", () => {
    const cleanup = installFakeDom();
    try {
        let prevented = false;
        preventYoutubeThumbnailDefaultAction({
            preventDefault() {
                prevented = true;
            }
        });
        assert.equal(prevented, true);

        const thumb = document.createElement("div");
        suppressYoutubeThumbnailContextMenu(thumb);
        prevented = false;
        invokeListener(thumb, "contextmenu", { preventDefault: () => { prevented = true; } });
        assert.equal(prevented, true);

        const img = createYoutubeThumbnailImage("video1");
        assert.ok(img);
        assert.equal(img.draggable, false);
        assert.equal(img.getAttribute("draggable"), "false");
        for (const type of ["contextmenu", "dragstart"]) {
            prevented = false;
            invokeListener(img, type, { preventDefault: () => { prevented = true; } });
            assert.equal(prevented, true, `${type} must prevent the default action`);
        }
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: orientation, playing state, and expanded card state are reflected", () => {
    const cleanup = installFakeDom();
    try {
        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:test";
        const thumb = document.createElement("div");
        card.appendChild(thumb);

        setYoutubeThumbnailOrientation(thumb, "vertical");
        setYoutubeThumbnailPlaybackState(thumb, "playing");
        setYoutubeThumbnailExpandedCardState(thumb, true);

        assert.equal(thumb.dataset.videoOrientation, "vertical");
        assert.equal(thumb.classList.contains("playing"), true);
        assert.equal(card.classList.contains("song-card-expanded"), true);
        assert.equal(getSongKeyFromYoutubeThumb(thumb), "song:test");

        setYoutubeThumbnailPlaybackState(thumb, "stopped");
        setYoutubeThumbnailExpandedCardState(thumb, false);

        assert.equal(thumb.classList.contains("playing"), false);
        assert.equal(card.classList.contains("song-card-expanded"), false);
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: playback mode defaults to manual and can be stored or cleared", () => {
    const cleanup = installFakeDom();
    try {
        const thumb = document.createElement("div");
        assert.equal(getYoutubeThumbnailPlaybackMode(thumb), "manual");
        assert.equal(getYoutubeThumbnailPlaybackMode(null), "manual");

        setYoutubeThumbnailPlaybackMode(thumb, "autoplay");
        assert.equal(thumb.dataset.playbackMode, "autoplay");
        assert.equal(getYoutubeThumbnailPlaybackMode(thumb), "autoplay");

        setYoutubeThumbnailPlaybackMode(thumb);
        assert.equal(thumb.dataset.playbackMode, undefined);
        assert.equal(getYoutubeThumbnailPlaybackMode(thumb), "manual");
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: playback session id is stored only for positive values", () => {
    const cleanup = installFakeDom();
    try {
        const thumb = document.createElement("div");
        assert.equal(getYoutubeThumbnailPlaybackSessionId(thumb), 0);
        assert.equal(getYoutubeThumbnailPlaybackSessionId(null), 0);

        setYoutubeThumbnailPlaybackSessionId(thumb, 7);
        assert.equal(thumb.dataset.playbackSessionId, "7");
        assert.equal(getYoutubeThumbnailPlaybackSessionId(thumb), 7);

        setYoutubeThumbnailPlaybackSessionId(thumb, 0);
        assert.equal(thumb.dataset.playbackSessionId, undefined);
        assert.equal(getYoutubeThumbnailPlaybackSessionId(thumb), 0);
        assert.doesNotThrow(() => setYoutubeThumbnailPlaybackSessionId(null, 3));
    } finally {
        cleanup();
    }
});

test("youtube thumbnail: playback target stores end seconds and clears back to the thumbnail", () => {
    const cleanup = installFakeDom();
    try {
        const thumb = document.createElement("div");
        setYoutubeThumbnailPlaybackTarget(thumb, {
            videoId: "video1",
            playbackKey: "video1:5:25",
            playbackEndSeconds: 25
        });
        assert.equal(thumb.dataset.videoId, "video1");
        assert.equal(thumb.dataset.playbackKey, "video1:5:25");
        assert.equal(getYoutubeThumbnailPlaybackEndSeconds(thumb), 25);

        setYoutubeThumbnailPlaybackTarget(thumb, {
            videoId: "video1",
            playbackKey: "video1:5:",
            playbackEndSeconds: 0
        });
        assert.equal(thumb.dataset.playbackEndSeconds, undefined);
        assert.equal(getYoutubeThumbnailPlaybackEndSeconds(thumb), null);

        setYoutubeThumbnailPlaybackTarget(thumb, {
            videoId: "video2",
            playbackKey: "video2:0:30",
            playbackEndSeconds: 30
        });
        clearYoutubeThumbnailPlaybackTarget(thumb, "video2");
        assert.equal(thumb.dataset.videoId, "video2");
        assert.equal(thumb.dataset.playbackKey, "");
        assert.equal(thumb.dataset.playbackEndSeconds, undefined);
        assert.equal(getYoutubeThumbnailPlaybackEndSeconds(null), null);
    } finally {
        cleanup();
    }
});

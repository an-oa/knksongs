import { test, expect } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { endLatestMockPlayback, setMockVideoBehavior, waitForMockYoutube } from "./support/mock-youtube.mts";
import { enablePlaybackSettings, filterBySongTitle, getControlLabel, getSongCard, openSettingsPanel, waitForInitialLoad } from "./support/ui-helpers.mts";

/** 動画が入った瞬間にプレーヤーが見えていた割合を、テストの間だけ持たせたサムネイル要素。 */
type ThumbWithRatioAtMount = Element & { ratioAtMount?: Promise<number> };

test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await page.evaluate(() => {
        localStorage.clear();
    });
    await page.reload();
    await waitForInitialLoad(page);
});

test("playback settings are gated by thumbnail visibility", async ({ page }) => {
    await openSettingsPanel(page);

    const thumbnailSwitch = getControlLabel(page, "#thumbnail-toggle");
    const playbackSettingsGroup = page.locator("#playback-settings-group");
    const experimentalPlaybackSettingsGroup = page.locator("#experimental-playback-settings");
    const playArchiveToEndSwitch = getControlLabel(page, "#play-archive-to-end-toggle");
    const themeSwitch = getControlLabel(page, "#theme-toggle");

    await expect(themeSwitch).toBeVisible();
    await expect(playbackSettingsGroup).toBeHidden();
    await expect(playArchiveToEndSwitch).toBeHidden();
    await expect(experimentalPlaybackSettingsGroup).toBeHidden();

    await thumbnailSwitch.click();

    await expect(themeSwitch).toBeVisible();
    await expect(playbackSettingsGroup).toBeVisible();
    await expect(playArchiveToEndSwitch).toBeVisible();
    await expect(page.locator("#play-archive-to-end-toggle-label")).toContainText("アーカイブ全体を再生");
    await expect(page.locator("#play-archive-to-end-toggle-help")).toContainText("OFFでは曲の終わりで停止します。");
    await expect(page.locator("#play-archive-to-end-toggle")).not.toBeChecked();

    await thumbnailSwitch.click();

    await expect(themeSwitch).toBeVisible();
    await expect(playbackSettingsGroup).toBeHidden();
    await expect(playArchiveToEndSwitch).toBeHidden();
    await expect(experimentalPlaybackSettingsGroup).toBeHidden();
});

test("console playback setting survives ui resync", async ({ page }) => {
    await openSettingsPanel(page);

    const thumbnailSwitch = getControlLabel(page, "#thumbnail-toggle");
    const playbackSettingsGroup = page.locator("#playback-settings-group");
    const experimentalPlaybackSettingsGroup = page.locator("#experimental-playback-settings");

    await thumbnailSwitch.click();
    await expect(playbackSettingsGroup).toBeVisible();
    await expect(experimentalPlaybackSettingsGroup).toBeHidden();
    expect(
        await page.evaluate(() => window.knkPlaybackSettings?.showExperimentalPlaybackSettings),
    ).toBe(false);

    await page.evaluate(() => {
        if (!window.knkPlaybackSettings) throw new Error("Playback settings API is unavailable");
        window.knkPlaybackSettings.showExperimentalPlaybackSettings = true;
    });

    expect(
        await page.evaluate(() => window.knkPlaybackSettings?.state.showExperimentalPlaybackSettings),
    ).toBe(true);
    await expect(playbackSettingsGroup).toBeVisible();
    await expect(experimentalPlaybackSettingsGroup).toBeVisible();

    await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
    });

    await expect(playbackSettingsGroup).toBeVisible();
    await expect(experimentalPlaybackSettingsGroup).toBeVisible();
});

test("archive playback setting persists across reload", async ({ page }) => {
    await openSettingsPanel(page);

    const thumbnailSwitch = getControlLabel(page, "#thumbnail-toggle");
    await thumbnailSwitch.click();

    const playArchiveToEndSwitch = getControlLabel(page, "#play-archive-to-end-toggle");
    await playArchiveToEndSwitch.click();

    await expect(page.locator("#play-archive-to-end-toggle")).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("playArchiveToEnd"))).toBe("true");

    await page.reload();
    await waitForInitialLoad(page);
    await openSettingsPanel(page);

    await expect(page.locator("#playback-settings-group")).toBeVisible();
    await expect(page.locator("#play-archive-to-end-toggle")).toBeChecked();
    expect(
        await page.evaluate(() => window.knkPlaybackSettings?.state.playArchiveToEnd),
    ).toBe(true);
});

test("manual playback mounts an iframe from the thumbnail", async ({ page }) => {
    await enablePlaybackSettings(page);
    await filterBySongTitle(page, "Manual Song");

    const manualCard = getSongCard(page, "Manual Song");
    await expect(manualCard).toBeVisible();

    await manualCard.locator(".thumb").click();
    await waitForMockYoutube(page);

    await expect(manualCard.locator("iframe")).toBeVisible();
    await expect(manualCard.locator(".thumb-close-btn")).toBeVisible();
});

test("thumbnail context menu is suppressed", async ({ page }) => {
    await enablePlaybackSettings(page);
    await filterBySongTitle(page, "Manual Song");

    const manualCard = getSongCard(page, "Manual Song");
    const thumbnail = manualCard.locator(".thumb");
    await expect(thumbnail.locator("img")).toBeVisible();

    await page.evaluate(() => {
        window.__knkLastThumbnailContextMenuPrevented = null;
        document.addEventListener("contextmenu", (event) => {
            window.__knkLastThumbnailContextMenuPrevented = event.defaultPrevented;
        }, { once: true });
    });
    await thumbnail.click({ button: "right" });

    await expect
        .poll(() => page.evaluate(() => window.__knkLastThumbnailContextMenuPrevented))
        .toBe(true);
});

test("same thumbnail can be replayed after returning from the embedded player", async ({ page }) => {
    await enablePlaybackSettings(page);
    await filterBySongTitle(page, "Replay Song");

    const replayCard = getSongCard(page, "Replay Song");
    await expect(replayCard).toBeVisible();

    await replayCard.locator(".thumb").click();
    await waitForMockYoutube(page);
    await expect(replayCard.locator("iframe")).toBeVisible();
    await expect(page.locator(".thumb.playing")).toHaveCount(1);

    await replayCard.locator(".thumb-close-btn").click();
    await expect(replayCard.locator("iframe")).toHaveCount(0);
    await expect(replayCard.locator("img")).toBeVisible();

    await replayCard.locator(".thumb").click();
    await expect(replayCard.locator("iframe")).toBeVisible();
    await expect.poll(async () => {
        return page.evaluate(() => window.__knkMockYoutube?.playerCount());
    }).toBe(2);
});

test("thumbnail images keep masonry layout stable after refresh", async ({ page }) => {
    await enablePlaybackSettings(page);
    await filterBySongTitle(page, "Artist");

    const cards = page.locator(".song-card");
    await expect(cards).toHaveCount(6);
    await expect(cards.first().locator("img")).toBeVisible();

    const before = await page.locator(".song-card").evaluateAll((nodes) => nodes.map((card) => {
        const image = card.querySelector("img");
        if (!image) throw new Error("Expected a thumbnail image in every song card");
        return {
            songKey: card.dataset.songKey || "",
            top: card.style.top,
            imageDisplay: window.getComputedStyle(image).display
        };
    }));

    await expect(before.every((entry) => entry.imageDisplay === "block")).toBe(true);

    await page.evaluate(async () => {
        // 実際のviewport更新経路で配置を再計算し、公開外moduleへ依存しない。
        window.dispatchEvent(new Event("resize"));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    const after = await page.locator(".song-card").evaluateAll((nodes) => nodes.map((card) => ({
        songKey: card.dataset.songKey || "",
        top: card.style.top
    })));

    await expect(after).toEqual(before.map(({ songKey, top }) => ({ songKey, top })));
});

test("manual playback failure advances to the next result when continuous playback is enabled", async ({ page }) => {
    await enablePlaybackSettings(page, { continuousPlayback: true });
    await setMockVideoBehavior(page, "reject-alph", "auto-error");
    await setMockVideoBehavior(page, "reject-beta", "auto-playing");
    await filterBySongTitle(page, "Reject");

    const firstCard = getSongCard(page, "Reject Alpha");
    const secondCard = getSongCard(page, "Reject Beta");
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();

    await firstCard.locator(".thumb").click();

    await expect(firstCard.locator("iframe")).toHaveCount(0);
    await expect(secondCard.locator("iframe")).toBeVisible();
    await expect.poll(async () => {
        return page.evaluate(() => window.__knkMockYoutube?.latestVideoId());
    }).toBe("reject-beta");
});

test("continuous playback advances to the next result after the current song ends", async ({ page }) => {
    await enablePlaybackSettings(page, { continuousPlayback: true });
    await setMockVideoBehavior(page, "chain-beta1", "auto-playing");
    await filterBySongTitle(page, "Chain");

    const firstCard = getSongCard(page, "Chain Alpha");
    const secondCard = getSongCard(page, "Chain Beta");
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();

    await firstCard.locator(".thumb").click();
    await expect(firstCard.locator("iframe")).toBeVisible();

    await endLatestMockPlayback(page);

    await expect(secondCard.locator("iframe")).toBeVisible();
    await expect.poll(async () => {
        return page.evaluate(() => window.__knkMockYoutube?.latestVideoId());
    }).toBe("chain-beta1");
});

test("continuous playback starts the next song only after its player is mostly on screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 400 });
    await enablePlaybackSettings(page, { continuousPlayback: true });
    await setMockVideoBehavior(page, "chain-beta1", "auto-playing");
    await filterBySongTitle(page, "Chain");

    const firstCard = getSongCard(page, "Chain Alpha");
    const secondCard = getSongCard(page, "Chain Beta");
    const secondThumb = secondCard.locator(".thumb");
    await firstCard.locator(".thumb").click();
    await expect(firstCard.locator("iframe")).toBeVisible();

    // 再生中のカードの下端を画面の下端にそろえ、次の曲のプレーヤーを画面の外へ出す。
    await firstCard.evaluate((card) => card.scrollIntoView({ block: "end", behavior: "instant" }));
    const ratioBeforeEnd = await secondThumb.evaluate((thumb) => {
        const header = document.querySelector(".header");
        const viewTop = Math.max(0, header ? header.getBoundingClientRect().bottom : 0);
        const rect = thumb.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, viewTop);
        return rect.height > 0 ? Math.max(0, visibleHeight) / rect.height : 0;
    });
    expect(ratioBeforeEnd).toBeLessThan(0.5);

    // 次の曲のサムネイルに動画が入った瞬間に、プレーヤーの見えている割合を測る。
    // 再生を終える前に監視を置き終えるよう、結果の Promise はサムネイル要素に持たせる。
    await secondThumb.evaluate((thumb) => {
        (thumb as ThumbWithRatioAtMount).ratioAtMount = new Promise<number>((resolve) => {
            const observer = new MutationObserver(() => {
                if (!thumb.querySelector("iframe")) return;
                observer.disconnect();
                const header = document.querySelector(".header");
                const viewTop = Math.max(0, header ? header.getBoundingClientRect().bottom : 0);
                const rect = thumb.getBoundingClientRect();
                const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, viewTop);
                resolve(rect.height > 0 ? Math.max(0, visibleHeight) / rect.height : 0);
            });
            observer.observe(thumb, { childList: true });
        });
    });

    await endLatestMockPlayback(page);

    await expect(secondCard.locator("iframe")).toBeVisible();
    const ratioAtMount = await secondThumb.evaluate((thumb) => (thumb as ThumbWithRatioAtMount).ratioAtMount);
    expect(ratioAtMount).toBeGreaterThan(0.5);
    await expect.poll(async () => {
        return page.evaluate(() => window.__knkMockYoutube?.latestVideoId());
    }).toBe("chain-beta1");
});

test("continuous playback does not double-start the first successful autoplay successor after a rejection", async ({ page }) => {
    await enablePlaybackSettings(page, { continuousPlayback: true });
    await filterBySongTitle(page, "Artist");
    await setMockVideoBehavior(page, "replay-vide", "auto-error");
    await setMockVideoBehavior(page, "chain-alpha", "auto-playing");

    const manualCard = getSongCard(page, "Manual Song");
    const replayCard = getSongCard(page, "Replay Song");
    const chainCard = getSongCard(page, "Chain Alpha");
    await expect(manualCard).toBeVisible();
    await expect(replayCard).toBeVisible();
    await expect(chainCard).toBeVisible();

    await manualCard.locator(".thumb").click();
    await expect(manualCard.locator("iframe")).toBeVisible();

    await endLatestMockPlayback(page);

    await expect(replayCard.locator("iframe")).toHaveCount(0);
    await expect(chainCard.locator("iframe")).toBeVisible();
    await expect.poll(async () => {
        return page.evaluate(() => window.__knkMockYoutube?.playerCount());
    }).toBe(3);
});

test("autoplay rejection is logged as autoplay and does not use the manual failure bridge", async ({ page }) => {
    const debugMessages: string[] = [];
    page.on("console", (message) => {
        debugMessages.push(message.text());
    });
    await page.evaluate(() => {
        window.__KNK_DEBUG_YOUTUBE__ = true;
    });
    await enablePlaybackSettings(page, { continuousPlayback: true });
    await filterBySongTitle(page, "Artist");
    await setMockVideoBehavior(page, "replay-vide", "auto-error");
    await setMockVideoBehavior(page, "chain-alpha", "auto-playing");

    const manualCard = getSongCard(page, "Manual Song");
    const chainCard = getSongCard(page, "Chain Alpha");
    await expect(manualCard).toBeVisible();

    await manualCard.locator(".thumb").click();
    await expect(manualCard.locator("iframe")).toBeVisible();

    await endLatestMockPlayback(page);

    await expect(chainCard.locator("iframe")).toBeVisible();
    await expect.poll(() => {
        return debugMessages.some((message) => message.includes(
            "[youtube] autoplay playback start failed; skipping candidate"
        ));
    }).toBe(true);
    await expect(
        debugMessages.some((message) => message.includes(
            "[script] continuePlayback requested from manual playback start failure"
        ))
    ).toBe(false);
});

test("autoplay rejection fallback restores the candidate thumbnail instead of leaving it stuck", async ({ page }) => {
    await enablePlaybackSettings(page, { continuousPlayback: true });
    await setMockVideoBehavior(page, "reject-beta", "auto-error");
    await filterBySongTitle(page, "Reject");

    const firstCard = getSongCard(page, "Reject Alpha");
    const secondCard = getSongCard(page, "Reject Beta");
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();

    await firstCard.locator(".thumb").click();
    await expect(firstCard.locator("iframe")).toBeVisible();

    await endLatestMockPlayback(page);

    await expect(secondCard.locator("iframe")).toHaveCount(0);
    await expect(secondCard.locator("img")).toBeVisible();
    await expect(page.locator(".thumb.playing")).toHaveCount(0);
    await expect.poll(async () => {
        return page.evaluate(() => window.__knkMockYoutube?.latestVideoId());
    }).toBe("reject-beta");
});

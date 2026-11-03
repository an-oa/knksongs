import { test, expect } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import { clickControlLabel, closeSidebar, getSongCard, openSidebar, waitForInitialLoad } from "./support/ui-helpers.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";

test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await page.evaluate(() => {
        localStorage.clear();
    });
    await page.reload();
    await waitForInitialLoad(page);
});

test("result tail sentinel appends search results when scrolling to the bottom", async ({ page }) => {
    await routeSongsJsonFixture(page, createScrollableResultSongs(60));
    await page.reload();
    await waitForInitialLoad(page);

    await page.locator("#searchBox").fill("Scroll Artist");
    await expect(page.locator("#searchBox")).toHaveValue("Scroll Artist");

    const cards = page.locator(".song-card");
    const resultTailSentinel = page.locator("#resultTailSentinel");

    await expect(cards).toHaveCount(48);
    await expect(resultTailSentinel).not.toHaveAttribute("hidden", "");

    await resultTailSentinel.scrollIntoViewIfNeeded();

    await expect(cards).toHaveCount(60);
    await expect(getSongCard(page, "Scroll Song 60")).toBeVisible();
    await expect(resultTailSentinel).toHaveAttribute("hidden", "");
});

test("search box date operators validate input and filter songs", async ({ page }) => {
    const searchBox = page.locator("#searchBox");
    const searchError = page.locator("#searchBoxError");
    await expect(page.locator("#searchBoxHelp")).toHaveCount(0);
    await expect(searchBox).toHaveAttribute("aria-errormessage", "searchBoxError");

    await searchBox.fill("since:2024-02-30");
    await expect(searchBox).toHaveAttribute("aria-invalid", "true");
    await expect(searchError).toContainText("実在する日付");
    await expect(searchError).toContainText("二重引用符");
    await expect(searchError).toBeVisible();
    await expect(page.locator("#resultCount")).toHaveText("0 件がヒット");

    await searchBox.fill("since:2024-01-05 until:2024-01-04");
    await expect(searchBox).toHaveAttribute("aria-invalid", "true");
    await expect(searchError).toContainText("since の日付は until の日付以前");
    await expect(page.locator("#resultCount")).toHaveText("0 件がヒット");

    await searchBox.fill("Chain since:2024-01-04 until:2024-01-04");
    await expect(searchBox).not.toHaveAttribute("aria-invalid", "true");
    await expect(searchError).toBeHidden();
    await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");

    await expect(getSongCard(page, "Chain Alpha")).toHaveCount(0);
    await expect(getSongCard(page, "Chain Beta")).toBeVisible();
});

test("search box restores an invalid query with its error and empty results", async ({ page }) => {
    const searchBox = page.locator("#searchBox");
    await searchBox.fill("until:2026-13");
    await expect(searchBox).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#resultCount")).toHaveText("0 件がヒット");

    await page.reload();
    await waitForInitialLoad(page);

    await expect(page.locator("#resultCount")).toHaveText("0 件がヒット");
    await expect(page.locator("#searchBox")).toHaveValue("until:2026-13");
    await expect(page.locator("#searchBox")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#searchBoxError")).toBeVisible();
});

test("search box treats an empty quoted query as recommendations after restore", async ({ page }) => {
    const searchBox = page.locator("#searchBox");
    await searchBox.fill('""');
    await expect(searchBox).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#searchBoxError")).toBeHidden();
    await expect(page.locator("#resultCount")).toHaveText("おすすめを表示中");

    await page.reload();
    await waitForInitialLoad(page);

    await expect(page.locator("#resultCount")).toHaveText("おすすめを表示中");
    await expect(page.locator("#searchBox")).toHaveValue('""');
    await expect(page.locator("#searchBoxError")).toBeHidden();
});

test("search box treats quoted phrases as literal text", async ({ page }) => {
    const [literalSong, escapedQuoteSong] = createScrollableResultSongs(2);
    literalSong.title = "Song until:2026-13";
    literalSong.titleYomi = "Song until:2026-13";
    literalSong.titleNorm = "song until:2026-13";
    literalSong.titleYomiNorm = "song until:2026-13";
    escapedQuoteSong.title = 'Don’t say "lazy"';
    escapedQuoteSong.titleYomi = 'Don’t say "lazy"';
    escapedQuoteSong.titleNorm = 'don’t say "lazy"';
    escapedQuoteSong.titleYomiNorm = 'don’t say "lazy"';
    await routeSongsJsonFixture(page, [literalSong, escapedQuoteSong]);
    await page.reload();
    await waitForInitialLoad(page);

    const searchBox = page.locator("#searchBox");

    await searchBox.fill("until:2026-13");
    await expect(searchBox).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#resultCount")).toHaveText("0 件がヒット");

    await searchBox.fill('"Song until:2026-13"');

    await expect(searchBox).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");

    await searchBox.fill(String.raw`"Don’t say \"lazy\""`);
    await expect(searchBox).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");
    await expect(getSongCard(page, 'Don’t say "lazy"')).toBeVisible();
});

test("collab role filters switch between host and guest results", async ({ page }) => {
    await openSidebar(page);
    await clickControlLabel(page, "#collabGuestOnly");
    await expect(page.locator("#collabGuestOnly")).toBeChecked();
    await closeSidebar(page);

    const guestCard = getSongCard(page, "Chain Alpha");
    await expect(guestCard).toBeVisible();
    await expect(guestCard.locator(".tag-collab")).toHaveText("コラボ");
    await expect(getSongCard(page, "Manual Song")).toHaveCount(0);
    await expect(getSongCard(page, "Replay Song")).toHaveCount(0);

    await openSidebar(page);
    await clickControlLabel(page, "#collabGuestOnly");
    await clickControlLabel(page, "#collabHostOnly");
    await expect(page.locator("#collabGuestOnly")).not.toBeChecked();
    await expect(page.locator("#collabHostOnly")).toBeChecked();
    await closeSidebar(page);

    const hostCard = getSongCard(page, "Replay Song");
    await expect(hostCard).toBeVisible();
    await expect(hostCard.locator(".tag-collab")).toHaveText("コラボ");
    await expect(getSongCard(page, "Manual Song")).toHaveCount(0);
    await expect(getSongCard(page, "Chain Alpha")).toHaveCount(0);

    await openSidebar(page);
    await clickControlLabel(page, "#collabGuestOnly");
    await expect(page.locator("#collabHostOnly")).toBeChecked();
    await expect(page.locator("#collabGuestOnly")).toBeChecked();
    await closeSidebar(page);

    await expect(getSongCard(page, "Replay Song")).toBeVisible();
    await expect(getSongCard(page, "Chain Alpha")).toBeVisible();
    await expect(getSongCard(page, "Manual Song")).toHaveCount(0);

    await openSidebar(page);
    await clickControlLabel(page, "#collabHostOnly");
    await clickControlLabel(page, "#collabGuestOnly");
    await closeSidebar(page);
    await page.locator("#searchBox").fill("Replay Song");
    await expect(page.locator("#searchBox")).toHaveValue("Replay Song");

    await expect(getSongCard(page, "Replay Song")).toBeVisible();
});

test("saved legacy guest frame scope is restored as collab guest filter", async ({ page }) => {
    await page.evaluate(() => {
        localStorage.setItem("searchStateV1", JSON.stringify({
            version: 2,
            query: "",
            relayOnly: false,
            harmonyOnly: false,
            frameScope: "guest",
            dateFrom: "",
            dateTo: "",
            formats: ["配信", "歌みた", "ショート", "切り抜き", "収録"]
        }));
    });
    await page.reload();
    await waitForInitialLoad(page);

    await expect(page.locator("#collabGuestOnly")).toBeChecked();
    await expect(page.locator("#collabHostOnly")).not.toBeChecked();
    await expect(getSongCard(page, "Chain Alpha")).toBeVisible();
    await expect(getSongCard(page, "Manual Song")).toHaveCount(0);
    await expect(getSongCard(page, "Replay Song")).toHaveCount(0);
});

test("result summary chips show active conditions and remove them individually or together", async ({ page }) => {
    const conditions = page.locator("#resultConditions .result-condition-chip");
    const clearAll = page.locator("#resultClearAll");
    await expect(conditions).toHaveCount(0);
    await expect(clearAll).toBeHidden();

    await page.locator("#searchBox").fill("Song");
    await openSidebar(page);
    await clickControlLabel(page, "#collabHostOnly");
    await closeSidebar(page);

    await expect(conditions).toHaveText(["「Song」×", "コラボ(ホスト)×"]);
    await expect(clearAll).toBeVisible();

    await conditions.filter({ hasText: "コラボ(ホスト)" }).click();
    await expect(page.locator("#collabHostOnly")).not.toBeChecked();
    await expect(conditions).toHaveText(["「Song」×"]);
    await expect(conditions.first()).toBeFocused();

    await clearAll.click();
    await expect(page.locator("#searchBox")).toHaveValue("");
    await expect(conditions).toHaveCount(0);
    await expect(clearAll).toBeHidden();
    await expect(page.locator("#resultCount")).toHaveText("おすすめを表示中");
    await expect(page.locator("#searchBox")).toBeFocused();
});

test("clear conditions button resets the search form, results, and saved state", async ({ page }) => {
    await page.locator("#searchBox").fill("Song");
    await openSidebar(page);
    await clickControlLabel(page, "#collabHostOnly");
    await page.locator("#dateFromYear").selectOption("2024");
    await page.locator("#dateFromMonth").selectOption("01");
    await page.locator("#dateFromDay").selectOption("02");
    await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");
    await expect(getSongCard(page, "Replay Song")).toBeVisible();

    await page.locator("#clearBtn").click();

    await expect(page.locator("#searchBox")).toHaveValue("");
    await expect(page.locator("#collabHostOnly")).not.toBeChecked();
    await expect(page.locator("#dateFromYear")).toHaveValue("");
    await expect(page.locator("#dateFromMonth")).toHaveValue("");
    await expect(page.locator("#dateFromDay")).toHaveValue("");
    await expect(page.locator("#resultCount")).toHaveText("おすすめを表示中");
    await expect.poll(() => page.evaluate(() => {
        const saved = localStorage.getItem("searchStateV1");
        return saved ? JSON.parse(saved) : null;
    })).toMatchObject({ query: "", collabHostOnly: false, dateFrom: "", dateTo: "" });
});

test("long search queries keep the condition chip within a narrow page", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    const longQuery = "A".repeat(120);
    await page.locator("#searchBox").fill(longQuery);

    const chip = page.locator("#resultConditions .result-condition-chip");
    await expect(chip).toHaveAttribute("title", `「${longQuery}」`);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
    const chipBox = await chip.boundingBox();
    expect(chipBox && chipBox.x + chipBox.width).toBeLessThanOrEqual(393);
});

test("an artist name can be selected and a click on the blank area clears the selection", async ({ page }) => {
    await routeSongsJsonFixture(page, createScrollableResultSongs(6));
    await page.reload();
    await waitForInitialLoad(page);
    await page.locator("#searchBox").fill("Scroll Artist");
    const artist = page.locator("#resultList > .song-card .artist").first();
    await expect(artist).toHaveText("Scroll Artist");

    await artist.click({ clickCount: 3 });
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? "")).toBe("Scroll Artist");

    // カードのない一覧の余白を探す。ページ全体を選択しない指定にすると、ここをクリックしても選択が残る。
    const blankPoint = await page.locator("#resultList").evaluate((list) => {
        const rect = list.getBoundingClientRect();
        for (let y = rect.top + 2; y < Math.min(rect.bottom, window.innerHeight); y += 4) {
            for (let x = rect.left + 2; x < rect.right; x += 4) {
                if (document.elementFromPoint(x, y) === list) return { x, y };
            }
        }
        return null;
    });
    if (!blankPoint) throw new Error("The result list has no blank area on screen");
    await page.mouse.click(blankPoint.x, blankPoint.y);

    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
});

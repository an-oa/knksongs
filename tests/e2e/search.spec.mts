import { test, expect, type Locator, type Page } from "@playwright/test";
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

const LONG_SONG_TITLE = "Aitsu Koso ga Tennis no Oujisama ~Seigaku and Yamabuki Medley~ Scroll Song 01";
const LONG_SONG_ARTIST = "Seigaku Members, Yamabuki Members, Hajime Mizuki, and Wakashi Hiyoshi";
const NAME_NOT_SCROLLING = { scrolling: false, animations: [] };
const NAME_SCROLLING = { scrolling: true, animations: ["card-text-marquee"] };

/**
 * 曲名とアーティスト名がカードに収まらない曲を 1 件含む結果を表示する。
 * @param page 検証するページ
 * @returns 名前が収まらない曲のカード
 */
async function showLongNameSongCard(page: Page) {
    const songs = createScrollableResultSongs(6);
    const titleNorm = LONG_SONG_TITLE.toLowerCase();
    const artistNorm = LONG_SONG_ARTIST.toLowerCase();
    songs[0] = {
        ...songs[0],
        title: LONG_SONG_TITLE,
        titleYomi: LONG_SONG_TITLE,
        titleEn: LONG_SONG_TITLE,
        titleNorm,
        titleYomiNorm: titleNorm,
        titleEnNorm: titleNorm,
        artist: LONG_SONG_ARTIST,
        artistYomi: LONG_SONG_ARTIST,
        artistEn: LONG_SONG_ARTIST,
        artistNorm,
        artistYomiNorm: artistNorm,
        artistEnNorm: artistNorm,
        artistSortNorm: artistNorm
    };
    await routeSongsJsonFixture(page, songs);
    await page.reload();
    await waitForInitialLoad(page);
    await page.locator("#searchBox").fill("Scroll Song");
    const card = getSongCard(page, LONG_SONG_TITLE);
    await expect(card).toHaveCount(1);
    return card;
}

/**
 * カードの曲名とアーティスト名を、文字を流しているかと合わせて読む。
 * 外側の要素が 1 行の幅で切り、内側の文字の要素を動かす。
 * @param card 結果カード
 * @returns 曲名、アーティスト名の順に、収まらないか・流しているか・動いているアニメーション
 */
function readNameScroll(card: Locator) {
    return card.locator(".title, .artist").evaluateAll((elements) => elements.map((el) => ({
        overflows: el.scrollWidth > el.clientWidth,
        scrolling: el.classList.contains("is-marquee-scrolling"),
        animations: (el.querySelector(".card-name-text")?.getAnimations() ?? []).map((animation) => animation.id)
    })));
}

/**
 * 名前の文字の要素を横へずらしている量を読む。
 * @param card 結果カード
 * @param selector 曲名なら ".title"、アーティスト名なら ".artist"
 * @returns 横へずらしている量。左へずらしているときは負
 */
function readNameShift(card: Locator, selector: ".title" | ".artist") {
    return card.locator(`${selector} > .card-name-text`)
        .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
}

test("pointing at a card scrolls the names that do not fit and leaving it brings back the ellipsis", async ({ page }) => {
    const longCard = await showLongNameSongCard(page);
    const shortCard = getSongCard(page, "Scroll Song 02");
    const stopped = [{ overflows: true, ...NAME_NOT_SCROLLING }, { overflows: true, ...NAME_NOT_SCROLLING }];

    // 曲名もカードの幅で切り、カードの外へはみ出さない。
    expect(await readNameScroll(longCard)).toEqual(stopped);
    const titleRight = await longCard.locator(".title").evaluate((el) => el.getBoundingClientRect().right);
    const contentRight = await longCard.locator(".content").evaluate((el) => el.getBoundingClientRect().right);
    expect(titleRight).toBeLessThanOrEqual(contentRight);
    // 切った名前はスクロールできず、スクリプトでも横にずれない。ずれると流す位置が狂う。
    expect(await longCard.locator(".artist").evaluate((el) => {
        el.scrollLeft = 10;
        return el.scrollLeft;
    })).toBe(0);

    await longCard.locator(".title").hover();
    await expect.poll(() => readNameScroll(longCard)).toEqual([{ overflows: true, ...NAME_SCROLLING }, { overflows: true, ...NAME_SCROLLING }]);
    // 流している間も、指した曲名のリンクに下線を引く。
    await expect(longCard.locator(".title > .card-name-text")).toHaveCSS("text-decoration-line", "underline");
    // 先頭で止めた後に、左へ流れる。
    await expect.poll(() => readNameShift(longCard, ".artist")).toBeLessThan(0);

    // 収まる名前のカードへ移ると、前のカードは止まり、収まる名前は流さない。
    await shortCard.hover();
    await expect.poll(() => readNameScroll(longCard)).toEqual(stopped);
    expect(await readNameShift(longCard, ".artist")).toBe(0);
    await expect(longCard.locator(".artist")).toHaveCSS("text-overflow", "ellipsis");
    expect(await readNameScroll(shortCard)).toEqual([{ overflows: false, ...NAME_NOT_SCROLLING }, { overflows: false, ...NAME_NOT_SCROLLING }]);

    // 動きを減らす設定では流さない。
    await page.emulateMedia({ reducedMotion: "reduce" });
    await longCard.hover();
    expect(await readNameScroll(longCard)).toEqual(stopped);
});

test("keyboard focus in a card scrolls the names that do not fit until focus leaves the card", async ({ page }) => {
    const longCard = await showLongNameSongCard(page);
    const scrolling = [{ overflows: true, ...NAME_SCROLLING }, { overflows: true, ...NAME_SCROLLING }];
    const title = longCard.locator(".title");
    const addButton = longCard.locator(".add-to-bookmark-btn");

    // 検索欄から Tab で曲名のリンクまで進む。
    await page.locator("#searchBox").focus();
    for (let i = 0; i < 20 && !(await title.evaluate((el) => el === document.activeElement)); i++) {
        await page.keyboard.press("Tab");
    }
    await expect(title).toBeFocused();
    await expect.poll(() => readNameScroll(longCard)).toEqual(scrolling);

    // カード内のボタンへ移っても流し続け、カードの外へ移ると止める。
    await page.keyboard.press("Tab");
    await expect(addButton).toBeFocused();
    expect(await readNameScroll(longCard)).toEqual(scrolling);
    await page.keyboard.press("Tab");
    await expect(addButton).not.toBeFocused();
    await expect.poll(() => readNameScroll(longCard)).toEqual([
        { overflows: true, ...NAME_NOT_SCROLLING },
        { overflows: true, ...NAME_NOT_SCROLLING }
    ]);
});

/**
 * 指でカードの上をなぞる。一覧が短くスクロールしないときも、タップにはならない。
 * なぞる操作は Chromium の DevTools Protocol でだけ送れる。
 * @param page 検証するページ
 * @param card なぞる結果カード
 */
async function swipeOverCard(page: Page, card: Locator) {
    const box = await card.boundingBox();
    if (!box) throw new Error("The card has no bounding box");
    const client = await page.context().newCDPSession(page);
    await client.send("Input.synthesizeScrollGesture", {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
        yDistance: -100,
        gestureSourceType: "touch"
    });
    await client.detach();
}

test.describe("on a touch screen", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
    const scrolling = [{ overflows: true, ...NAME_SCROLLING }, { overflows: true, ...NAME_SCROLLING }];
    const stopped = [{ overflows: true, ...NAME_NOT_SCROLLING }, { overflows: true, ...NAME_NOT_SCROLLING }];

    test("tapping a card scrolls the names until another card is tapped", async ({ page }) => {
        const longCard = await showLongNameSongCard(page);
        const shortCard = getSongCard(page, "Scroll Song 02");

        // タップすると、カードの影と同じく、指を離した後も流し続ける。
        await longCard.locator(".artist").tap();
        await expect.poll(() => readNameScroll(longCard)).toEqual(scrolling);

        // 別のカードをタップすると止める。
        await shortCard.locator(".artist").tap();
        await expect.poll(() => readNameScroll(longCard)).toEqual(stopped);
    });

    test("swiping over a card does not scroll the names", async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "指でなぞる操作は Chromium の DevTools Protocol でだけ送れる");
        const longCard = await showLongNameSongCard(page);
        await swipeOverCard(page, longCard);
        expect(await readNameScroll(longCard)).toEqual(stopped);
    });

    test("a keyboard click after a swipe is not taken for a tap", async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "指でなぞる操作は Chromium の DevTools Protocol でだけ送れる");
        const longCard = await showLongNameSongCard(page);
        const addButton = longCard.locator(".add-to-bookmark-btn");
        await swipeOverCard(page, longCard);

        // なぞった後に、キーボードでカードの追加ボタンへ移ると流れる。
        await page.locator("#searchBox").focus();
        for (let i = 0; i < 20 && !(await addButton.evaluate((el) => el === document.activeElement)); i++) {
            await page.keyboard.press("Tab");
        }
        await expect(addButton).toBeFocused();
        await expect.poll(() => readNameScroll(longCard)).toEqual(scrolling);

        // Enter でブックマークの追加を開き、フォーカスがカードの外へ移ると止める。
        await page.keyboard.press("Enter");
        await expect(addButton).not.toBeFocused();
        await expect.poll(() => readNameScroll(longCard)).toEqual(stopped);
    });
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

test("inputs changed without the user typing are put back to the conditions the results were made from", async ({ page }) => {
    await page.locator("#searchBox").fill("Manual Song");
    await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");
    await openSidebar(page);

    // ブラウザがフォームの値を復元した場合と同じく、操作のイベントなしで入力欄だけを書き換える。
    await page.evaluate(() => {
        const searchBox = document.querySelector<HTMLInputElement>("#searchBox");
        const relayOnly = document.querySelector<HTMLInputElement>("#relayOnly");
        const formatCheckbox = document.querySelector<HTMLInputElement>("#formatsList input");
        if (!searchBox || !relayOnly || !formatCheckbox) throw new Error("The condition inputs are missing");
        searchBox.value = "restored by the browser";
        relayOnly.checked = true;
        formatCheckbox.checked = false;
        window.dispatchEvent(new Event("pageshow"));
    });

    await expect(page.locator("#searchBox")).toHaveValue("Manual Song");
    await expect(page.locator("#relayOnly")).not.toBeChecked();
    await expect(page.locator("#formatsList input").first()).toBeChecked();
    // 条件そのものは変わっていないので、結果も保存した条件もそのまま。
    await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("searchStateV1") ?? "{}").query)).toBe("Manual Song");
});

test("the condition inputs ask the browser not to restore their values", async ({ page }) => {
    await openSidebar(page);
    for (const selector of [
        "#searchBox", "#relayOnly", "#harmonyOnly", "#collabHostOnly", "#collabGuestOnly",
        "#dateFromYear", "#dateFromMonth", "#dateFromDay", "#dateToYear", "#dateToMonth", "#dateToDay"
    ]) {
        await expect(page.locator(selector), selector).toHaveAttribute("autocomplete", "off");
    }
    const formatCheckboxes = page.locator("#formatsList input");
    await expect(formatCheckboxes).not.toHaveCount(0);
    for (const checkbox of await formatCheckboxes.all()) {
        await expect(checkbox).toHaveAttribute("autocomplete", "off");
    }
});

test("Enter in the search box shows the results without waiting for the typing pause", async ({ page }) => {
    const searchBox = page.locator("#searchBox");
    await searchBox.click();
    // 入力のたびに少し待ってから検索するので、待ち時間のうちに Enter を押す。
    await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>("#searchBox");
        if (!input) throw new Error("The search box is missing");
        input.value = "Manual Song";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        // 同じ処理の中で読むので、待ち時間は経過していない。
        document.body.dataset.countRightAfterEnter = document.querySelector("#resultCount")?.textContent ?? "";
    });
    expect(await page.evaluate(() => document.body.dataset.countRightAfterEnter)).toBe("1 件がヒット");
    // マウスが主な入力手段の画面では、続けて入力できるようフォーカスを残す。
    await expect(searchBox).toBeFocused();
});

test.describe("on a phone", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

    test("the search box is large enough not to zoom the page, and Enter closes the keyboard", async ({ page }) => {
        const searchBox = page.locator("#searchBox");
        // iOS の Safari は、16px 未満の入力欄にフォーカスするとページを拡大する。
        expect(await searchBox.evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
        await expect(searchBox).toHaveAttribute("enterkeyhint", "search");

        const hasCoarsePointer = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
        test.skip(!hasCoarsePointer, "このブラウザのエミュレーションは、主な入力手段を指として報告しない");
        await searchBox.tap();
        await page.keyboard.type("Manual Song");
        await page.keyboard.press("Enter");
        await expect(page.locator("#resultCount")).toHaveText("1 件がヒット");
        // フォーカスを外して画面のキーボードを閉じ、結果を見えるようにする。
        await expect(searchBox).not.toBeFocused();
    });

    test("filter and setting controls are tall enough to tap, and a switch toggles from its label", async ({ page }) => {
        await openSidebar(page);
        /** 要素の高さを返す。 */
        const heightOf = async (selector: string) => (await page.locator(selector).boundingBox())?.height ?? 0;
        // WCAG 2.5.8 の目安の 24px を、行そのものの高さで満たす。
        expect(await heightOf("#clearBtn")).toBeGreaterThanOrEqual(24);
        expect(await heightOf("#dateFromYear")).toBeGreaterThanOrEqual(24);
        expect(await heightOf("label[for=relayOnly]")).toBeGreaterThanOrEqual(24);
        expect(await page.locator("#dateFromYear").evaluate((select) => Number.parseFloat(getComputedStyle(select).fontSize)))
            .toBeGreaterThanOrEqual(getRequiredDateSelectFontSize(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)));

        await page.locator("#open-settings-panel").click();
        expect(await heightOf("label[for=theme-toggle]")).toBeGreaterThanOrEqual(24);
        // スイッチ自体は小さいので、項目名を押しても切り替わる。
        await expect(page.locator("#theme-toggle")).not.toBeChecked();
        await page.locator("#theme-toggle-label").tap();
        await expect(page.locator("#theme-toggle")).toBeChecked();
        await expect(page.locator("html")).toHaveClass(/dark-theme/);
        await page.locator("#theme-toggle-label").tap();
        await expect(page.locator("#theme-toggle")).not.toBeChecked();
    });
});

/**
 * 日付の選択欄に求める文字の大きさを返す。指で操作する端末では、iOS の拡大を避ける 16px を求める。
 * @param hasCoarsePointer 主な入力手段が指かどうか
 */
function getRequiredDateSelectFontSize(hasCoarsePointer: boolean): number {
    return hasCoarsePointer ? 16 : 13;
}

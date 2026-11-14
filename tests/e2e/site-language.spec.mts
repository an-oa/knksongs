import { test, expect, type Page } from "@playwright/test";
import { normalizeForSearch } from "../../app/lib/search-normalization.mts";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import { expectBookmarkToast, openBookmarkPanel, openSidebar, waitForInitialLoad } from "./support/ui-helpers.mts";

/**
 * 曲名・アーティスト名を差し替え、検索に使う正規化済みの値も同じ名前から作り直す。
 */
function withSongNames(song: Song, names: Pick<Song, "title" | "artist" | "titleEn" | "artistEn">): Song {
    return {
        ...song,
        ...names,
        titleYomi: names.title,
        artistYomi: names.artist,
        titleNorm: normalizeForSearch(names.title),
        artistNorm: normalizeForSearch(names.artist),
        titleYomiNorm: normalizeForSearch(names.title),
        artistYomiNorm: normalizeForSearch(names.artist),
        titleEnNorm: normalizeForSearch(names.titleEn),
        artistEnNorm: normalizeForSearch(names.artistEn),
        artistSortNorm: normalizeForSearch(names.artistEn)
    };
}

/**
 * 英語表記の切り替えを検証するため、英語表記のある曲とない曲を用意する。
 */
function createEnglishNamedSongs() {
    const [withEnglish, withoutEnglish] = createScrollableResultSongs(2);
    return [
        withSongNames(withEnglish, { title: "表記テスト アイネクライネ", artist: "米津玄師", titleEn: "Eine Kleine", artistEn: "Kenshi Yonezu" }),
        withSongNames(withoutEnglish, { title: "表記テスト 日本語だけ", artist: "歌手", titleEn: "", artistEn: "" })
    ];
}

/**
 * 保存済みの設定を消し、英語表記のある曲を読み込んで検索する。
 */
async function openWithEnglishNamedSongs(page: Page, query: string) {
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, createEnglishNamedSongs());
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitForInitialLoad(page);
    await page.locator("#searchBox").fill(query);
}

/** 言語ボタンで見えている文言。ボタンには両方の文言を重ねてあり、切り替え先の言語だけが見える。 */
function getVisibleLanguageLabel(page: Page) {
    return page.locator("#site-language-btn .language-btn-label:visible");
}

/** 英語表記のある曲のカードの曲名。表記が変わっても同じカードを指す。 */
function getEnglishCardTitle(page: Page) {
    return page.locator("#resultList .song-card .title").filter({ hasText: /アイネクライネ|Eine Kleine/ });
}

test.describe("Japanese browsers", () => {
    test.use({ locale: "ja-JP" });

    test("start in Japanese and switch the site to English from the header", async ({ page }) => {
        await openWithEnglishNamedSongs(page, "表記テスト");
        const languageButton = page.locator("#site-language-btn");
        const englishCardTitle = getEnglishCardTitle(page);
        const japaneseOnlyTitle = page.locator("#resultList .song-card .title").filter({ hasText: "日本語だけ" });

        await expect(page.locator("html")).toHaveAttribute("lang", "ja");
        await expect(englishCardTitle).toHaveText("表記テスト アイネクライネ");
        await expect(page.locator("#resultCount")).toHaveText("2 件がヒット");
        await expect(page.locator("#open-sidebar")).toContainText("絞り込み");
        await expect(getVisibleLanguageLabel(page)).toHaveText("English");
        await expect(languageButton).toHaveAttribute("lang", "en");

        await languageButton.click();

        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(englishCardTitle).toHaveText("Eine Kleine");
        await expect(englishCardTitle).not.toHaveAttribute("lang", /.*/);
        await expect(japaneseOnlyTitle).toHaveText("表記テスト 日本語だけ");
        await expect(japaneseOnlyTitle).toHaveAttribute("lang", "ja");
        await expect(page.locator("#resultCount")).toHaveText("2 results");
        await expect(page.locator("#open-sidebar")).toContainText("Filters");
        await expect(page.locator("#searchBox")).toHaveAttribute("placeholder", "Song or artist...");
        await expect(getVisibleLanguageLabel(page)).toHaveText("日本語");
        await expect(languageButton).toHaveAttribute("lang", "ja");
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("siteLanguage")))
            .toBe("en");

        await page.reload();
        await waitForInitialLoad(page);
        await page.locator("#searchBox").fill("Eine Kleine");
        await expect(englishCardTitle).toHaveText("Eine Kleine");
        await expect(getVisibleLanguageLabel(page)).toHaveText("日本語");
    });
});

test.describe("header layout", () => {
    test.use({ locale: "ja-JP", viewport: { width: 1280, height: 720 } });

    test("switching the language keeps the logo, search box, spots, and buttons in place", async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem("theme", "light"));
        await openWithEnglishNamedSongs(page, "表記テスト");
        // ロゴとボタンは両方の言語の文言を重ねて幅を固定しているので、切り替えても検索窓と斑点は動かない。
        const readHeaderLayout = () => page.evaluate(() => [
            ".header-wordmark", ".header-search", ".header-spots-wide-left", ".header-spots-wide-right", "#site-language-btn", "#open-sidebar"
        ].map((selector) => {
            const element = document.querySelector(selector);
            if (!element || getComputedStyle(element).display === "none") return `${selector}: hidden`;
            const rect = element.getBoundingClientRect();
            return `${selector}: ${rect.left},${rect.width}`;
        }));
        const before = await readHeaderLayout();
        expect(before.filter((entry) => entry.endsWith("hidden")), "the spots are shown at 1280px").toEqual([]);

        await page.locator("#site-language-btn").click();
        await expect(getVisibleLanguageLabel(page)).toHaveText("日本語");
        await expect(page.locator(".header-wordmark-main:visible")).toHaveText("Kaneki Caw");

        expect(await readHeaderLayout()).toEqual(before);
    });
});

test.describe("header spots", () => {
    test.use({ locale: "en-US", viewport: { width: 1280, height: 720 } });

    test("the wide spots stay clear of the logo and search box around the width where they appear", async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem("theme", "light"));
        await openWithEnglishNamedSongs(page, "Eine Kleine");
        // 検索窓の領域の幅を、斑点を出す境界(732px)の前後の小数を含む値に固定して、斑点の表示と位置を確かめる。
        // 英語のロゴは日本語より幅が広いので、文字と斑点の間隔は英語で確かめる。
        for (const areaWidth of [731, 731.4, 731.6, 732, 760.5, 811.5, 812, 900]) {
            const layout = await page.evaluate((width) => {
                const header = document.querySelector<HTMLElement>(".header");
                if (header) header.style.gridTemplateColumns = `auto ${width}px auto`;
                const area = document.querySelector(".header-search-area")?.getBoundingClientRect();
                const search = document.querySelector(".header-search")?.getBoundingClientRect();
                const text = [...document.querySelectorAll(".header-wordmark-text")]
                    .find((element) => getComputedStyle(element).visibility !== "hidden")
                    ?.getBoundingClientRect();
                /** 斑点の黒い部分の左右の端を返す。表示していなければ null。 */
                const readSpot = (selector: string) => {
                    const spot = document.querySelector(selector);
                    if (!spot || getComputedStyle(spot).display === "none") return null;
                    const paths = [...spot.querySelectorAll("path")].map((path) => path.getBoundingClientRect());
                    return { left: Math.min(...paths.map((path) => path.left)), right: Math.max(...paths.map((path) => path.right)) };
                };
                return {
                    area: area?.width ?? null,
                    search: search ? { left: search.left, right: search.right } : null,
                    textRight: text?.right ?? null,
                    left: readSpot(".header-spots-wide-left"),
                    right: readSpot(".header-spots-wide-right")
                };
            }, areaWidth);
            const label = `search area ${areaWidth}px`;
            expect(layout.area, label).toBeCloseTo(areaWidth, 1);
            expect(layout.left === null, `${label}: both spots are shown or hidden together`).toBe(layout.right === null);
            expect(layout.left !== null, `${label}: spots are shown from 732px`).toBe(areaWidth >= 732);
            if (!layout.left || !layout.right || !layout.search || layout.textRight === null) continue;
            expect(layout.left.left - layout.textRight, `${label}: the left spot keeps 8px from the logo`).toBeGreaterThanOrEqual(7.5);
            expect(layout.left.right, `${label}: the left spot stays off the search box`).toBeLessThanOrEqual(layout.search.left);
            expect(layout.right.left, `${label}: the right spot stays off the search box`).toBeGreaterThanOrEqual(layout.search.right);
        }
    });
});

test.describe("language in the URL", () => {
    test.use({ locale: "ja-JP" });

    test("the English OGP page sends visitors to the site in English", async ({ page }) => {
        await installNetworkMocks(page);
        await routeSongsJsonFixture(page, createEnglishNamedSongs());
        await page.goto("/");
        await page.evaluate(() => localStorage.clear());
        await page.goto("/en/");
        await page.waitForURL((url) => url.pathname === "/" && url.search === "");
        await waitForInitialLoad(page);

        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.locator(".header-wordmark-main:visible")).toHaveText("Kaneki Caw");
    });

    test("?lang=en opens the site in English, saves the choice, and drops the query", async ({ page }) => {
        await installNetworkMocks(page);
        await routeSongsJsonFixture(page, createEnglishNamedSongs());
        await page.goto("/");
        await page.evaluate(() => localStorage.clear());
        await page.goto("/?lang=en");
        await waitForInitialLoad(page);

        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.locator("html")).not.toHaveClass(/i18n-pending/);
        await expect(page).toHaveTitle("Kaneki Caw Song Search");
        expect(new URL(page.url()).search).toBe("");
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("siteLanguage")))
            .toBe("en");
    });
});

test.describe("English browsers", () => {
    test.use({ locale: "en-US" });

    test("start in English without any setting", async ({ page }) => {
        await openWithEnglishNamedSongs(page, "Eine Kleine");

        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.locator("html")).not.toHaveClass(/i18n-pending/);
        await expect(page).toHaveTitle("Kaneki Caw Song Search");
        await expect(page.locator(".header-wordmark-main:visible")).toHaveText("Kaneki Caw");
        await expect(page.locator(".header-wordmark-sub:visible")).toHaveText("Song Search");
        await expect(getEnglishCardTitle(page)).toHaveText("Eine Kleine");
        await expect(page.locator("#resultCount")).toHaveText("1 result");
        await expect(page.locator("#resultList .song-card .tag").first()).toHaveText("Stream");
        await expect(getVisibleLanguageLabel(page)).toHaveText("日本語");

        await openSidebar(page);
        await expect(page.locator("#sidebar-title")).toHaveText("Filters & Settings");
        await expect(page.locator("#formatsList")).toContainText("Originals & Covers");
        await expect(page.locator("#dateFromYear option[value='']")).toHaveText("YYYY");
        await expect(page.locator("label[for='relayOnly']")).toContainText("Relay stream");

        await expect(page.locator("#open-bookmark-panel")).toContainText("Bookmarks");
        await page.locator("#open-bookmark-panel").click();
        await expect(page.locator("#bookmark-panel-create-btn")).toHaveText("Create");
        await expect(page.locator("#bookmark-panel-new-name")).toHaveAttribute("placeholder", "New bookmark");
        await expect(page.locator("#bookmark-list")).toContainText("No bookmarks yet.");
    });

    test("keep the narrow-screen Holstein spot clear of the English logo", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 740 });
        await page.addInitScript(() => localStorage.setItem("theme", "light"));
        await openWithEnglishNamedSongs(page, "Eine Kleine");

        const gap = await page.evaluate(() => {
            const wordmark = document.querySelector(".header-wordmark")?.getBoundingClientRect();
            const spots = [...document.querySelectorAll(".header-spots-compact path")].map((path) => path.getBoundingClientRect());
            return wordmark && spots.length > 0 ? Math.min(...spots.map((spot) => spot.left)) - wordmark.right : null;
        });
        expect(gap).not.toBeNull();
        expect(gap).toBeGreaterThanOrEqual(0);
    });

    test("show the language button next to the search box on narrow screens", async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await openWithEnglishNamedSongs(page, "Eine Kleine");
        const languageButton = page.locator("#site-language-btn");

        await expect(languageButton).toBeVisible();
        const buttonBox = await languageButton.boundingBox();
        const searchBox = await page.locator("#searchBox").boundingBox();
        expect(buttonBox).not.toBeNull();
        expect(searchBox).not.toBeNull();
        if (!buttonBox || !searchBox) return;
        expect(Math.abs((buttonBox.y + buttonBox.height / 2) - (searchBox.y + searchBox.height / 2))).toBeLessThan(2);
        expect(buttonBox.x).toBeGreaterThanOrEqual(searchBox.x + searchBox.width);
        expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(360);
    });
});

/** インポートのダイアログに並べる、新しいブックマーク 2 件のファイル。 */
const TWO_NEW_BOOKMARKS_FILE = {
    name: "bookmarks.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
        version: 3,
        bookmarks: {
            first: { name: "First Import", songs: ["song-a"], createdAt: 1 },
            second: { name: "Second Import", songs: ["song-b"], createdAt: 2 }
        }
    }))
};

/**
 * 別のタブでサイトを英語に切り替え、元のタブへ戻る。
 * 元のタブは、戻ったときの focus で保存された言語に合わせ直す。
 */
async function switchToEnglishInAnotherTab(page: Page) {
    const otherTab = await page.context().newPage();
    await installNetworkMocks(otherTab);
    await otherTab.goto("/");
    await waitForInitialLoad(otherTab);
    await otherTab.locator("#site-language-btn").click();
    await expect.poll(() => otherTab.evaluate(() => localStorage.getItem("siteLanguage"))).toBe("en");
    await otherTab.close();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
}

test.describe("language changed in another tab", () => {
    test.use({ locale: "ja-JP" });

    test("an open import dialog is rewritten in English and keeps the selection and focus", async ({ page }) => {
        await openWithEnglishNamedSongs(page, "");
        await openBookmarkPanel(page);
        await page.locator("#bookmark-panel-import-input").setInputFiles(TWO_NEW_BOOKMARKS_FILE);
        const dialog = page.locator("#bookmark-transfer-dialog");
        const firstOption = dialog.getByRole("checkbox", { name: /First Import/ });
        await expect(dialog.locator("#bookmark-transfer-title")).toHaveText("ブックマークのインポート");
        await firstOption.uncheck();
        await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("1件を追加");

        await switchToEnglishInAnotherTab(page);

        await expect(dialog.locator("#bookmark-transfer-title")).toHaveText("Import bookmarks");
        await expect(dialog.locator(".bookmark-transfer-option-badge")).toHaveText(["New", "New"]);
        await expect(dialog.locator(".bookmark-transfer-option-detail")).toHaveText(["1 song", "1 song"]);
        await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("Add 1");
        await expect(firstOption).not.toBeChecked();
        await expect(dialog.getByRole("checkbox", { name: /Second Import/ })).toBeChecked();
        await expect(firstOption).toBeFocused();

        await dialog.getByRole("button", { name: "Import", exact: true }).click();
        await expect(dialog).toBeHidden();
        await expectBookmarkToast(page, "Added 1 bookmark.");
    });

    test("a failure shown in the dialog and the panel error are rewritten in English", async ({ page }) => {
        await openWithEnglishNamedSongs(page, "");
        await openBookmarkPanel(page);
        await page.locator("#bookmark-panel-import-input").setInputFiles(TWO_NEW_BOOKMARKS_FILE);
        const dialog = page.locator("#bookmark-transfer-dialog");
        const status = dialog.locator("#bookmark-transfer-status");
        // ブックマークの保存を失敗させ、ダイアログに失敗の理由を出す。
        await page.evaluate(() => {
            const originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key: string, value: string) {
                if (key === "bookmarksV1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
                return originalSetItem.call(this, key, value);
            };
        });
        await dialog.getByRole("button", { name: "インポート", exact: true }).click();
        await expect(status).toHaveText("インポートしたブックマークを保存できませんでした。");

        await switchToEnglishInAnotherTab(page);

        await expect(status).toHaveText("Couldn't save the imported bookmarks.");
        await expect(status).toHaveClass(/bookmark-transfer-status-error/);
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog).toBeHidden();

        // パネル上部のエラー欄も、出したままなら新しい言語で書き直す。
        await page.evaluate(() => localStorage.setItem("siteLanguage", "ja"));
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(page.locator("html")).toHaveAttribute("lang", "ja");
        await page.locator("#bookmark-panel-import-input").setInputFiles({
            name: "large.json",
            mimeType: "application/json",
            buffer: Buffer.alloc(1024 * 1024 + 1, " ")
        });
        const panelError = page.locator("#bookmark-panel-error");
        await expect(panelError).toHaveText("インポートできるファイルは最大1 MBです。");

        await switchToEnglishInAnotherTab(page);

        await expect(panelError).toHaveText("Import files can be up to 1 MB.");
    });
});

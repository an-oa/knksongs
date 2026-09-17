import { getViewportHeight, isHtmlElement } from "../dom-utils.mjs";

export const DEFAULT_MASONRY_GAP_PX = 12;
export const DEFAULT_MASONRY_MIN_CARD_WIDTH_PX = 294;
export const DEFAULT_MASONRY_CARD_CONTENT_HEIGHT_PX = 74;

const MASONRY_GAP_PROPERTY = "--masonry-gap";
const MASONRY_MIN_CARD_WIDTH_PROPERTY = "--masonry-min-card-width";
const MASONRY_CARD_CONTENT_ESTIMATE_PROPERTY = "--masonry-card-content-estimate";

type MasonryLayoutOptions = {
    gapPx?: number;
    minCardWidthPx?: number;
};

type MasonryVisibleCardCountOptions = MasonryLayoutOptions & {
    cardContentHeightPx?: number;
    minItemCount?: number;
    viewportHeight?: number;
};

type InitialResultDisplayOptions = {
    defaultCount: number;
    showThumbnails: boolean;
    viewportHeight?: number;
};

type MasonryMetrics = {
    gapPx: number;
    minCardWidthPx: number;
    cardContentHeightPx: number;
};

type MasonryGeometry = MasonryMetrics & {
    containerRect: DOMRect;
    containerWidth: number;
    columnCount: number;
    totalGap: number;
    columnWidth: number;
};

/**
 * 有効な正の数値だけを採用し、それ以外は fallback を返す。
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function resolvePositiveNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 有効な 0 以上の数値だけを採用し、それ以外は fallback を返す。
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function resolveNonNegativeNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * CSS custom property の px 値を数値として読み取る。
 * @param {HTMLElement} container
 * @param {string} propertyName
 * @returns {number | undefined}
 */
function readCssPixelCustomProperty(container: HTMLElement, propertyName: string): number | undefined {
    if (typeof getComputedStyle !== "function") return undefined;
    const rawValue = getComputedStyle(container).getPropertyValue(propertyName).trim();
    if (!rawValue) return undefined;
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

/**
 * masonry 配置と初期表示見積もりで共有する寸法を、CSS 変数を既定値として解決する。
 * CSS 側のカード余白や推定高さを変更するときは、#resultList の custom property を更新する。
 * @param {HTMLElement} container
 * @param {MasonryVisibleCardCountOptions} [options]
 * @returns {MasonryMetrics}
 */
function resolveMasonryMetrics(
    container: HTMLElement,
    options: MasonryVisibleCardCountOptions = {}
): MasonryMetrics {
    const cssGapPx = readCssPixelCustomProperty(container, MASONRY_GAP_PROPERTY);
    const cssMinCardWidthPx = readCssPixelCustomProperty(container, MASONRY_MIN_CARD_WIDTH_PROPERTY);
    const cssCardContentHeightPx = readCssPixelCustomProperty(
        container,
        MASONRY_CARD_CONTENT_ESTIMATE_PROPERTY
    );
    return {
        gapPx: resolvePositiveNumber(
            options.gapPx,
            resolvePositiveNumber(cssGapPx, DEFAULT_MASONRY_GAP_PX)
        ),
        minCardWidthPx: resolvePositiveNumber(
            options.minCardWidthPx,
            resolvePositiveNumber(cssMinCardWidthPx, DEFAULT_MASONRY_MIN_CARD_WIDTH_PX)
        ),
        cardContentHeightPx: resolveNonNegativeNumber(
            options.cardContentHeightPx,
            resolveNonNegativeNumber(cssCardContentHeightPx, DEFAULT_MASONRY_CARD_CONTENT_HEIGHT_PX)
        )
    };
}

/**
 * コンテナ幅と最小カード幅に対応する masonry の列数を返す。
 * 本番コードでは applyMasonryLayout 経由で使い、幅境界を単体テストするため export している。
 * @param {number} containerWidth
 * @param {{ gapPx?: number, minCardWidthPx?: number }} [options]
 * @returns {number}
 */
export function getMasonryColumnCount(
    containerWidth: number,
    options: MasonryLayoutOptions = {}
): number {
    const width = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
    if (width <= 0) return 1;
    const gapPx = resolvePositiveNumber(options.gapPx, DEFAULT_MASONRY_GAP_PX);
    const minCardWidthPx = resolvePositiveNumber(
        options.minCardWidthPx,
        DEFAULT_MASONRY_MIN_CARD_WIDTH_PX
    );
    return Math.max(1, Math.floor((width + gapPx) / (minCardWidthPx + gapPx)));
}

/**
 * masonry 配置に使う列数・gap・列幅をまとめて算出する。
 * @param {HTMLElement} masonryContainer
 * @param {MasonryVisibleCardCountOptions} [options]
 * @returns {MasonryGeometry | null}
 */
function resolveMasonryGeometry(
    masonryContainer: HTMLElement,
    options: MasonryVisibleCardCountOptions = {}
): MasonryGeometry | null {
    const metrics = resolveMasonryMetrics(masonryContainer, options);
    const containerRect = masonryContainer.getBoundingClientRect();
    const containerWidth = masonryContainer.clientWidth || containerRect.width || 0;
    if (containerWidth <= 0) return null;
    const columnCount = getMasonryColumnCount(containerWidth, metrics);
    const totalGap = metrics.gapPx * (columnCount - 1);
    const columnWidth = Math.max(0, (containerWidth - totalGap) / columnCount);
    return {
        ...metrics,
        containerRect,
        containerWidth,
        columnCount,
        totalGap,
        columnWidth
    };
}

/**
 * 現在の viewport と masonry 幅から、初期表示で一画面を埋めるためのカード数を見積もる。
 * 本番コードではおすすめ抽出上限に使い、viewport 境界を単体テストするため export している。
 * @param {unknown} container
 * @param {{ gapPx?: number, minCardWidthPx?: number, cardContentHeightPx?: number, minItemCount?: number, viewportHeight?: number }} [options]
 * @returns {number}
 */
export function estimateMasonryVisibleCardCount(
    container: unknown,
    options: MasonryVisibleCardCountOptions = {}
): number {
    const minItemCount = Math.max(0, Math.floor(resolveNonNegativeNumber(options.minItemCount, 0)));
    if (!isHtmlElement(container)) return minItemCount;
    const masonryContainer = container as HTMLElement;
    const geometry = resolveMasonryGeometry(masonryContainer, options);
    if (!geometry) return minItemCount;
    const viewportHeight = resolveNonNegativeNumber(options.viewportHeight, getViewportHeight());
    const availableHeight = Math.max(0, viewportHeight - Math.max(0, geometry.containerRect.top));
    if (availableHeight <= 0) return minItemCount;

    const estimatedCardHeight = geometry.columnWidth * (9 / 16) + geometry.cardContentHeightPx;
    const rowCount = Math.max(1, Math.ceil(
        (availableHeight + geometry.gapPx) / (estimatedCardHeight + geometry.gapPx)
    ));
    return Math.max(minItemCount, geometry.columnCount * rowCount);
}

/**
 * 1列の初期描画を約2画面分（最低12件）に絞り、残りは既存の末尾監視で追加する。
 * 複数列や寸法未確定時は呼び出し元の件数を保つ。おすすめの抽選件数は変更しない。
 */
export function estimateInitialResultDisplayCount(
    container: unknown,
    { defaultCount, showThumbnails, viewportHeight = getViewportHeight() }: InitialResultDisplayOptions
): number {
    if (!isHtmlElement(container)) return defaultCount;
    const geometry = resolveMasonryGeometry(container as HTMLElement);
    if (!geometry || geometry.columnCount !== 1 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
        return defaultCount;
    }
    const thumbnailHeight = showThumbnails ? geometry.columnWidth * (9 / 16) : 0;
    const cardHeight = thumbnailHeight + geometry.cardContentHeightPx + geometry.gapPx;
    const targetHeight = Math.max(0, viewportHeight * 2 - Math.max(0, geometry.containerRect.top));
    return Math.min(defaultCount, Math.max(12, Math.ceil(targetHeight / cardHeight)));
}

/**
 * 1列は通常フロー、複数列はDOM順を列固定で保つ絶対配置でカードを並べる。
 * @param {unknown} container
 * @param {{ gapPx?: number, minCardWidthPx?: number }} [options]
 */
export function applyMasonryLayout(container: unknown, options: MasonryLayoutOptions = {}): void {
    if (!isHtmlElement(container)) return;
    const masonryContainer = container as HTMLElement;
    const cards = Array.from(masonryContainer.children).filter((node): node is HTMLElement => (
        isHtmlElement(node) &&
        (node as HTMLElement).classList.contains("song-card")
    ));
    if (cards.length === 0) {
        masonryContainer.style.height = "";
        return;
    }
    const geometry = resolveMasonryGeometry(masonryContainer, options);
    if (!geometry) return;
    masonryContainer.dataset.layoutColumns = String(geometry.columnCount);
    if (geometry.columnCount === 1) {
        // 1列ではブラウザの通常配置に任せ、カードの高さを測定しない。
        masonryContainer.style.height = "";
        for (const node of cards) {
            node.style.width = "";
            node.style.left = "";
            node.style.top = "";
            node.style.transform = "";
            node.dataset.layoutColumn = "0";
        }
        return;
    }
    const columnHeights = Array.from({ length: geometry.columnCount }, () => 0);
    for (const node of cards) {
        node.style.width = `${geometry.columnWidth}px`;
    }
    // 幅の反映後に全カードの高さを一括で読み、位置の書き込みで再計算を挟まない。
    const contentHeights = cards.map((node) => {
        const scrollHeight = node.scrollHeight;
        return Number.isFinite(scrollHeight) && scrollHeight > 0
            ? scrollHeight
            : node.getBoundingClientRect().height;
    });
    for (let index = 0; index < cards.length; index++) {
        const node = cards[index];
        const columnIndex = index % geometry.columnCount;
        const top = columnHeights[columnIndex];
        const left = (geometry.columnWidth + geometry.gapPx) * columnIndex;
        node.style.left = `${left}px`;
        node.style.top = `${top}px`;
        node.style.transform = "none";
        node.dataset.layoutColumn = String(columnIndex);
        columnHeights[columnIndex] = top + contentHeights[index] + geometry.gapPx;
    }
    const tallest = Math.max(...columnHeights);
    masonryContainer.style.height = `${Math.max(0, tallest - geometry.gapPx)}px`;
}

#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveProjectPath } from "./lib/paths.mts";

/*
 * ブランドのゴーグル（Mk VIII 型の飛行用ゴーグル、黄色いドームのレンズ）の SVG を組み立てる。
 * 形は平らな正面図として描き、頭に巻いたように円筒へ巻き付けてから、目の高さの透視で縮める。
 * 巻き付けた曲線は手で編集できないため、SVG はこのスクリプトから作り直す。
 */

type Point = readonly [number, number];
/** 3次ベジェ曲線の1区間。制御点2つと終点。 */
type Segment = readonly [Point, Point, Point];
interface Subpath {
    start: Point;
    segments: Segment[];
    closed: boolean;
}

const INK = "#1b1b1b";

// ---- 巻き付け: 半径 R の頭に巻いた形を、距離 D から目の高さ CY で正面に見る。
const HEAD_RADIUS = 75;
const VIEW_DISTANCE = 110;
const EYE_LINE = 55;
/** 巻き付ける前に横へ伸ばす率。巻き付けで横幅が縮むぶんを補う。 */
const STRETCH_X = 1.15;

/** 平らな図の点を、頭に巻いて正面から見た位置へ移す。 */
function warp([x, y]: Point): Point {
    const angle = ((x - 50) * STRETCH_X) / HEAD_RADIUS;
    const scale = perspectiveScale(angle);
    return [50 + HEAD_RADIUS * Math.sin(angle) * scale, EYE_LINE + (y - EYE_LINE) * scale];
}

/** 頭の正面から angle だけ回り込んだ位置の、遠近による縮小率。 */
function perspectiveScale(angle: number): number {
    return VIEW_DISTANCE / (VIEW_DISTANCE + HEAD_RADIUS * (1 - Math.cos(angle)));
}

// ---- path: 絶対座標の M L H V C Z だけを読み、すべて3次ベジェ区間にそろえる。

/** 直線を3次ベジェ区間として表す。 */
function lineSegment(from: Point, to: Point): Segment {
    return [lerp(from, to, 1 / 3), lerp(from, to, 2 / 3), to];
}

/** 2点の間を t で内分した点。 */
function lerp(a: Point, b: Point, t: number): Point {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * 絶対座標の path データを subpath の配列へ変換する。
 * 本番では同じ module 内で使う helper で、境界条件を単体テストするために export している。
 */
export function parsePath(d: string): Subpath[] {
    const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
    const subpaths: Subpath[] = [];
    let current: Subpath | null = null;
    let position: Point = [0, 0];
    let command = "";
    let index = 0;
    const next = (): number => Number.parseFloat(tokens[index++]);
    const active = (): Subpath => {
        if (!current) throw new Error(`Path must start with M: ${d}`);
        return current;
    };
    while (index < tokens.length) {
        // 相対座標の小文字の命令は扱わないので、大文字にそろえず未対応として止める。
        if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
        if (command === "M") {
            position = [next(), next()];
            current = { start: position, segments: [], closed: false };
            subpaths.push(current);
            command = "L";
        } else if (command === "L" || command === "H" || command === "V") {
            const to: Point = command === "L" ? [next(), next()] : command === "H" ? [next(), position[1]] : [position[0], next()];
            active().segments.push(lineSegment(position, to));
            position = to;
        } else if (command === "C") {
            const segment: Segment = [[next(), next()], [next(), next()], [next(), next()]];
            active().segments.push(segment);
            position = segment[2];
        } else if (command === "Z") {
            active().closed = true;
            position = active().start;
            command = "";
        } else {
            throw new Error(`Unsupported path data: ${d}`);
        }
    }
    return subpaths;
}

/** 左目の図を中央線で折り返して右目の図にする。 */
function mirrorPoint([x, y]: Point): Point {
    return [100 - x, y];
}

/** 3次ベジェ区間の t0..t1 の部分を取り出す。 */
function subCurve(p0: Point, segment: Segment, t0: number, t1: number): [Point, Point, Point, Point] {
    const split = (a: Point, b: Point, c: Point, d: Point, t: number): [Point, Point, Point, Point, Point, Point, Point] => {
        const ab = lerp(a, b, t);
        const bc = lerp(b, c, t);
        const cd = lerp(c, d, t);
        const abc = lerp(ab, bc, t);
        const bcd = lerp(bc, cd, t);
        const mid = lerp(abc, bcd, t);
        return [a, ab, abc, mid, bcd, cd, d];
    };
    const [a, b, c, d] = split(p0, segment[0], segment[1], segment[2], t1);
    if (t0 === 0) return [a, b, c, d];
    const right = split(a, b, c, d, t0 / t1);
    return [right[3], right[4], right[5], right[6]];
}

/** 数値を小数2桁までの短い文字列にする。 */
function num(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/** 点を path データ用の文字列にする。 */
function pt([x, y]: Point): string {
    return `${num(x)} ${num(y)}`;
}

/**
 * 平らな図の path を巻き付けた path データへ変換する。
 * 曲線を短い区間に分けて制御点ごと巻き付けるので、出力も3次ベジェのまま保てる。
 */
function warpPath(d: string, mirror = false): string {
    return parsePath(d).map((subpath) => {
        const map = mirror ? mirrorPoint : (p: Point) => p;
        let previous = map(subpath.start);
        let out = `M${pt(warp(previous))}`;
        for (const raw of subpath.segments) {
            const segment: Segment = [map(raw[0]), map(raw[1]), map(raw[2])];
            const pieces = Math.max(1, Math.ceil(Math.hypot(segment[2][0] - previous[0], segment[2][1] - previous[1]) / 6));
            for (let k = 0; k < pieces; k++) {
                const [, c1, c2, end] = subCurve(previous, segment, k / pieces, (k + 1) / pieces);
                out += `C${pt(warp(c1))} ${pt(warp(c2))} ${pt(warp(end))}`;
            }
            previous = segment[2];
        }
        return subpath.closed ? `${out}Z` : out;
    }).join("");
}

/** 平らな図の点群をすべて巻き付け、外接矩形を求める。 */
function warpedBounds(paths: string[]): { x0: number, x1: number, y0: number, y1: number } {
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const d of paths) {
        for (const mirror of [false, true]) {
            for (const subpath of parsePath(d)) {
                let previous = mirror ? mirrorPoint(subpath.start) : subpath.start;
                for (const raw of subpath.segments) {
                    const segment: Segment = mirror ? [mirrorPoint(raw[0]), mirrorPoint(raw[1]), mirrorPoint(raw[2])] : raw;
                    for (let k = 0; k <= 16; k++) {
                        const [x, y] = warp(subCurve(previous, segment, 0, Math.max(k, 1e-6) / 16)[3]);
                        box.x0 = Math.min(box.x0, x);
                        box.x1 = Math.max(box.x1, x);
                        box.y0 = Math.min(box.y0, y);
                        box.y1 = Math.max(box.y1, y);
                    }
                    previous = segment[2];
                }
            }
        }
    }
    return box;
}

/** 角丸長方形の path データ。 */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
    const k = 0.5523 * r;
    return `M${x + r} ${y} H${x + w - r} C${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} V${y + h - r} `
        + `C${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} H${x + r} `
        + `C${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} V${y + r} C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} Z`;
}

/** 楕円の path データ。 */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
    const kx = 0.5523 * rx;
    const ky = 0.5523 * ry;
    return `M${cx - rx} ${cy} C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} `
        + `C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy} `
        + `C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry} `
        + `C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy} Z`;
}

// ---- 平らな図（左目側）。右目は折り返して描く。

/** レンズの縁の中心線。上辺はゆるいアーチ、鼻側の下の角は丸く落とす。 */
const LENS = "M44.8 39.6 C38 37.4 22 37.2 16.6 38.8 C12.6 40 12.3 45 12.5 50 C12.7 57 14 64.4 21 65.6 C27 66.6 34 65.7 38.6 63.7 C43.2 61.7 46.4 56.6 46.7 51 C47 46 47 41 44.8 39.6 Z";
/** 鼻の切れ込みがある一体の革のクッション。 */
const CUSHION = "M50 39.5 C42 35.4 22 33 13 35.6 C7 37.6 5.5 50 6.5 57 C7.5 65 15.5 73.6 27 74 C34.5 74.3 40.5 72.6 43.8 69.2 C46.4 66.5 47.8 64 50 64 C52.2 64 53.6 66.5 56.2 69.2 C59.5 72.6 65.5 74.3 73 74 C84.5 73.6 92.5 65 93.5 57 C94.5 50 93 37.6 87 35.6 C78 33 58 35.4 50 39.5 Z";
/** 横の蝶番の板。 */
const BRACKET = "M1.8 45 C4.5 44.2 8 44.6 10 45.6 C10.7 48.5 10.7 52.5 10 55.4 C8 56.4 4.5 56.8 1.8 56 C1.1 52.5 1.1 48.5 1.8 45 Z";
const HINGE_KNUCKLE = roundedRect(8.8, 46.6, 3.8, 7.8, 1.9);
/** 鼻の上で反る上のブリッジと、中央の蝶番。 */
const BRIDGE = "M38.6 36.3 C43.5 34.5 56.5 34.5 61.4 36.3 C62.6 36.8 62.6 39.6 61.4 40.1 C56.5 38.5 43.5 38.5 38.6 40.1 C37.4 39.6 37.4 36.8 38.6 36.3 Z";
const BRIDGE_HINGE = roundedRect(46.8, 33.6, 6.4, 6.8, 2.4);
/** レンズ上の窓の映り込み（両目とも同じ向き）。dx で右目へずらす。 */
const glare = (dx: number) => `M${31 + dx} 37 C${26.5 + dx} 46 ${23 + dx} 60 ${20.5 + dx} 76 L${26.5 + dx} 76 C${28.5 + dx} 60 ${32 + dx} 46 ${37 + dx} 37 Z`;
const glareThin = (dx: number) => `M${39 + dx} 37 C${35 + dx} 46 ${31.5 + dx} 60 ${29 + dx} 76 L${31 + dx} 76 C${33.5 + dx} 60 ${37 + dx} 46 ${41 + dx} 37 Z`;
/*
 * レンズは外側寄りの継ぎ目で折れた2枚のガラス（Mk VIII 型）。継ぎ目より外側のガラスは横を向く。
 * 正面のガラスの光沢は継ぎ目の手前で角を回って止め、外側のガラスは正面より暗くする。
 */
/** 継ぎ目より外側のガラス（左目）。 */
const OUTER_PANE = "M0 30 L20.7 30 L20.7 40.5 C20.1 47 20.1 56 20.9 63.6 L20.9 80 L0 80 Z";
/** 継ぎ目より内側の正面のガラス（左目）。映り込みはこの中だけに描く。 */
const FRONT_PANE = "M20.7 30 L60 30 L60 80 L20.9 80 L20.9 63.6 C20.1 56 20.1 47 20.7 40.5 Z";
/** 上の縁の光沢。正面のガラスの上辺を通り、継ぎ目の手前で下へ折れる。 */
const HIGHLIGHT = "M41.5 41.4 C34 40.3 27.5 40.2 24.2 40.6 C23 40.8 22.6 41.6 22.6 43 C22.6 44 22.6 45 22.6 46";
const HIGHLIGHT_DOT = "M38 41.6 C37 41.4 36 41.3 35 41.2";
/** 下の縁の照り返し。正面のガラスの下辺を通り、継ぎ目の手前で上へ折れる。 */
const BOUNCE = "M37.4 62 C32.5 63.5 27.5 64 24.2 63.8 C23 63.7 22.6 63 22.6 61.8 C22.6 60.8 22.6 60 22.6 59.2";
const PANE_SEAM_LIGHT = "M20.2 40.6 C19.6 47 19.6 56 20.4 63.6";
const PANE_SEAM_DARK = "M21 40.5 C20.4 47 20.4 56 21.2 63.5";
const CUSHION_LINE = "M9.2 60.5 C10.5 66.5 17 71.6 27 72 C33.5 72.3 38.5 71 41.4 68.6";
const BRIDGE_LINES = [[42.6, 36, 39], [44.7, 35.6, 38.7], [55.3, 35.6, 38.7], [57.4, 36, 39]] as const;

/** 細部の量と線の太さ。detailed は OGP・ホーム画面用、simple はファビコンとサイト内の小さな表示用。 */
const LEVELS = {
    detailed: { ink: 1.4, cushionInk: 2.2, rim: 2.2, rimInk: 0.9, glassInk: 0.7, edgeBand: 3.4 },
    simple: { ink: 2.2, cushionInk: 3, rim: 2.8, rimInk: 1.4, glassInk: 1, edgeBand: 3 }
} as const;
type Level = keyof typeof LEVELS;

/** 使うグラデーションとぼかし。detailed だけが空の映り込みとぼかしを使う。 */
function gradientDefs(level: Level): string {
    const detailedOnly = level === "detailed"
        ? `<radialGradient id="sky" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
            + `<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".35"/></filter>`
        : "";
    return `<radialGradient id="dome" cx=".5" cy=".47" r=".62" fx=".4" fy=".3">`
        + `<stop offset="0" stop-color="#fffbe0"/><stop offset=".2" stop-color="#fff0a0"/><stop offset=".48" stop-color="#ffd43a"/>`
        + `<stop offset=".76" stop-color="#f5b000"/><stop offset=".93" stop-color="#d88a00"/><stop offset="1" stop-color="#b56f00"/></radialGradient>`
        + `<linearGradient id="chrome" x1="0" x2="0" y1="0" y2="1">`
        + `<stop offset="0" stop-color="#fff"/><stop offset=".42" stop-color="#cfd4d9"/><stop offset=".5" stop-color="#7f878e"/>`
        + `<stop offset=".68" stop-color="#e9ecef"/><stop offset="1" stop-color="#9ba2a9"/></linearGradient>`
        + `<linearGradient id="gunmetal" x1="0" x2="0" y1="0" y2="1">`
        + `<stop offset="0" stop-color="#a3a9b0"/><stop offset=".4" stop-color="#5c6269"/><stop offset=".5" stop-color="#383d43"/>`
        + `<stop offset=".7" stop-color="#6e747b"/><stop offset="1" stop-color="#454a50"/></linearGradient>`
        + `<radialGradient id="leather" cx=".5" cy=".25" r=".9">`
        + `<stop offset="0" stop-color="#4a4a4a"/><stop offset=".6" stop-color="#2c2c2c"/><stop offset="1" stop-color="#1f1f1f"/></radialGradient>`
        + `<linearGradient id="shadeL" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".24"/><stop offset=".55" stop-color="#000" stop-opacity="0"/></linearGradient>`
        + `<linearGradient id="shadeR" x1="1" x2="0" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".24"/><stop offset=".55" stop-color="#000" stop-opacity="0"/></linearGradient>`
        + `<linearGradient id="shadeLR" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/>`
        + `<stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>`
        + detailedOnly;
}

/** 巻き付けた path 要素。 */
function path(d: string, attrs: string, mirror = false): string {
    return `<path d="${warpPath(d, mirror)}" ${attrs}/>`;
}

/** 左右の目に同じ図を描く。 */
function both(d: string, attrs: string): string {
    return path(d, attrs) + path(d, attrs, true);
}

/** 曲面の上の小さな丸（ねじ）。回り込むほど細く見える。 */
function dot(x: number, y: number, r: number, fill: string, mirror = false): string {
    const mx = mirror ? 100 - x : x;
    const [cx, cy] = warp([mx, y]);
    const angle = ((mx - 50) * STRETCH_X) / HEAD_RADIUS;
    const scale = perspectiveScale(angle);
    return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(r * Math.cos(angle) * scale)}" ry="${num(r * scale)}" fill="${fill}"/>`;
}

/**
 * バンド。横の蝶番から、蝶番を出るときの向きのまま遠くまで伸ばす。
 * 画像の枠（ファビコンの角丸、OGP の白い面、ロゴの枠）が端で切る。
 */
function strap(ink: number): string {
    let out = "";
    for (const side of [-1, 1]) {
        const outer = side < 0 ? 1.8 : 98.2;
        const near = side < 0 ? 3.8 : 96.2;
        const inner = side < 0 ? 14 : 86;
        const edge = (y: number) => {
            const at = warp([outer, y]);
            const toward = warp([near, y]);
            const dx = at[0] - toward[0];
            const dy = at[1] - toward[1];
            const k = ((side < 0 ? -300 : 400) - at[0]) / dx;
            return [warp([inner, y]), at, [at[0] + dx * k, at[1] + dy * k] as Point] as const;
        };
        const top = edge(45.5);
        const bottom = edge(55.5);
        out += `<path d="M${[...top, bottom[2], bottom[1], bottom[0]].map(pt).join("L")}Z" fill="#2b2b2b"/>`;
        for (const line of [top, bottom]) out += `<path d="M${line.map(pt).join("L")}" fill="none" stroke="${INK}" stroke-width="${num(ink * 1.4)}"/>`;
    }
    return out;
}

/** ゴーグル本体（バンドを含む）の SVG 要素列。 */
function goggles(level: Level): string {
    const v = LEVELS[level];
    const detailed = level === "detailed";
    const lensL = warpPath(LENS);
    const lensR = warpPath(LENS, true);
    const useLens = (side: "L" | "R", attrs: string) => `<use href="#lens${side}" ${attrs}/>`;
    const useBoth = (attrs: string) => useLens("L", attrs) + useLens("R", attrs);
    let out = `<defs>${gradientDefs(level)}<path id="lensL" d="${lensL}"/><path id="lensR" d="${lensR}"/>`
        + `<clipPath id="clipL"><use href="#lensL"/></clipPath><clipPath id="clipR"><use href="#lensR"/></clipPath>`
        + `<clipPath id="frontL"><path d="${warpPath(FRONT_PANE)}"/></clipPath><clipPath id="frontR"><path d="${warpPath(FRONT_PANE, true)}"/></clipPath></defs>`;
    out += strap(v.ink);
    out += path(CUSHION, `fill="url(#leather)" stroke="${INK}" stroke-width="${v.cushionInk}" stroke-linejoin="round"`);
    out += path(CUSHION, `fill="url(#shadeLR)"`);
    if (detailed) out += both(CUSHION_LINE, `fill="none" stroke="#555" stroke-width="1" stroke-linecap="round"`);
    // リム（ガンメタル）を描いてから、ドームのレンズをリムの内側半分に重ね、ガラスが枠より手前に見えるようにする。
    out += useBoth(`fill="none" stroke="${INK}" stroke-width="${num(v.rim + v.rimInk * 2)}" stroke-linejoin="round"`);
    out += useBoth(`fill="none" stroke="url(#gunmetal)" stroke-width="${v.rim}" stroke-linejoin="round"`);
    out += useBoth(`fill="url(#dome)"`);
    out += useLens("L", `fill="url(#shadeL)"`) + useLens("R", `fill="url(#shadeR)"`);
    for (const [side, dx] of [["L", 0], ["R", 34]] as const) {
        let inside = useLens(side, `fill="none" stroke="#9a5a00" stroke-width="${v.edgeBand}" opacity=".45"`);
        // 横を向いた外側のガラスは、正面より一段暗い琥珀色にする。
        inside += path(OUTER_PANE, `fill="#7a4300" opacity=".24"`, side === "R");
        let front = detailed ? path(ellipse(30, 46.5, 12, 5.2), `fill="url(#sky)"`, side === "R") : "";
        front += path(glare(dx), `fill="#fff" opacity="${detailed ? ".42" : ".5"}"`);
        if (detailed) front += path(glareThin(dx), `fill="#fff" opacity=".38"`);
        inside += `<g clip-path="url(#front${side})">${front}</g>`;
        out += `<g clip-path="url(#clip${side})">${inside}</g>`;
    }
    if (detailed) {
        out += both(PANE_SEAM_LIGHT, `fill="none" stroke="#fff" stroke-width=".7" opacity=".55"`);
        out += both(PANE_SEAM_DARK, `fill="none" stroke="#9a6500" stroke-width=".5" opacity=".45"`);
        out += `<g filter="url(#soft)">${both(HIGHLIGHT, `fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".95"`)}</g>`;
        out += both(HIGHLIGHT_DOT, `fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"`);
        out += `<g filter="url(#soft)">${both(BOUNCE, `fill="none" stroke="#fff6c8" stroke-width="1.1" stroke-linecap="round" opacity=".85"`)}</g>`;
    } else {
        out += both(HIGHLIGHT, `fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"`);
    }
    out += useBoth(`fill="none" stroke="${INK}" stroke-width="${v.glassInk}" stroke-linejoin="round"`);
    // 金具（クローム）: 横の蝶番と上のブリッジ。
    out += both(HINGE_KNUCKLE, `fill="url(#chrome)" stroke="${INK}" stroke-width="${num(v.ink * 0.8)}"`);
    out += both(BRACKET, `fill="url(#chrome)" stroke="${INK}" stroke-width="${v.ink}" stroke-linejoin="round"`);
    if (detailed) {
        out += dot(3.8, 53.8, 0.8, "#6f767d") + dot(3.8, 53.8, 0.8, "#6f767d", true);
        out += both("M8.4 46.4 C8.7 49 8.7 52 8.4 54.8", `fill="none" stroke="#6f767d" stroke-width=".6"`);
    }
    out += path(BRIDGE, `fill="url(#chrome)" stroke="${INK}" stroke-width="${v.ink}" stroke-linejoin="round"`);
    out += path(BRIDGE_HINGE, `fill="url(#chrome)" stroke="${INK}" stroke-width="${v.ink}"`);
    if (detailed) {
        for (const [x, y0, y1] of BRIDGE_LINES) out += path(`M${x} ${y0} C${x} ${y0 + 1} ${x} ${y1 - 1} ${x} ${y1}`, `fill="none" stroke="#6f767d" stroke-width=".6"`);
    }
    return out;
}

/** 巻き付けた本体（バンドを除く）の外接矩形。中央寄せと拡大率に使う。 */
const BODY_BOUNDS = warpedBounds([CUSHION, BRACKET, BRIDGE, BRIDGE_HINGE]);

/** 本体の中心を (50, 50) に合わせる transform。 */
function centerTransform(): string {
    const cx = (BODY_BOUNDS.x0 + BODY_BOUNDS.x1) / 2;
    const cy = (BODY_BOUNDS.y0 + BODY_BOUNDS.y1) / 2;
    return `translate(${num(50 - cx)} ${num(50 - cy)})`;
}

/**
 * 透明背景のゴーグル。バンドは viewBox の左右の端まで届く。
 * simple はヘッダーのロゴと検索結果0件の表示、detailed は OGP とホーム画面アイコンの描画元に使う。
 * @param level 細部の量
 * @param aspect viewBox の横:縦の比。横長のゴーグルを大きく見せたい枠では、上下の余白を詰めて横長にする
 */
export function createGogglesSvg(level: Level, aspect = 1): string {
    const height = 100 / aspect;
    const viewBox = `0 ${num(50 - height / 2)} 100 ${num(height)}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><g transform="${centerTransform()}">${goggles(level)}</g></svg>\n`;
}

/** ファビコン: 白い角丸の地にホルスタイン柄の斑点、ゴーグルは幅 60 に収め、バンドは角丸の端まで届く。 */
export function createFaviconSvg(): string {
    const scale = 60 / (BODY_BOUNDS.x1 - BODY_BOUNDS.x0);
    const offset = num(32 - 50 * scale);
    const spots = `<g fill="${INK}"><path d="M-4 -4h18c1 5-2 8-6 9-4 1-6 5-10 4-2 0-2-6-2-13z"/>`
        + `<path d="M56 -4h12v16c-4 1-8-1-9-4-1-3-4-4-4-7 0-2 0-4 1-5z"/>`
        + `<path d="M-4 52c4-2 9 0 10 4 1 3 0 6-2 12h-8z"/>`
        + `<path d="M52 56c3-3 9-2 11 1 1 2 1 5 0 11h-12c-1-4-1-9 1-12z"/></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
        + `<clipPath id="tile"><rect width="64" height="64" rx="14"/></clipPath>`
        + `<g clip-path="url(#tile)"><rect width="64" height="64" fill="#fff"/>${spots}`
        + `<g transform="translate(${offset} ${offset}) scale(${Math.round(scale * 10000) / 10000})"><g transform="${centerTransform()}">${goggles("simple")}</g></g></g></svg>\n`;
}

/** 書き出す SVG と、プロジェクトルートからの出力先。 */
export function brandSvgFiles(): { path: string, content: string }[] {
    return [
        // ヘッダーのロゴ枠（4:3）に合わせて横長にする。
        { path: "public/goggles.svg", content: createGogglesSvg("simple", 4 / 3) },
        { path: "public/favicon.svg", content: createFaviconSvg() },
        { path: "design/brand/goggles.svg", content: createGogglesSvg("detailed") }
    ];
}

/** ブランドの SVG を rootDir 配下へ書き出し、書いた path を返す。 */
export async function writeBrandSvgs(rootDir = process.cwd()): Promise<string[]> {
    const written: string[] = [];
    for (const file of brandSvgFiles()) {
        const outputPath = resolveProjectPath({ targetPath: file.path, rootDir, pathLabel: "Brand SVG output path" });
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, file.content);
        written.push(join(rootDir, file.path));
    }
    return written;
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryPointUrl) {
    try {
        for (const outputPath of await writeBrandSvgs()) console.log(`Wrote: ${outputPath}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}

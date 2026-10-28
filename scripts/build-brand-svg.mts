#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveProjectPath } from "./lib/paths.mts";

/*
 * ブランドのゴーグル（Mk VIII 型の飛行用ゴーグル、山吹色のドームのレンズ）の SVG を組み立てる。
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

/**
 * レンズの縁の中心線。上辺はゆるいアーチ、鼻側の下の角は丸く落とす。
 * 外側の上下の角は、2枚のガラスの継ぎ目の端から斜めにまっすぐ切り、角の立ったガラスにする。
 * 鼻側は2本の直線にして、ブリッジへ向けて尖らせる。尖りの位置は以前の丸い鼻側の一番外に合わせ、
 * ブリッジの金具の幅と、レンズの面積を以前に近く保つ。角はわずかに丸め、革より角を残す。
 */
const LENS = "M44.27 39.44 C38.76 37.84 28.22 37.4 21.35 38.02 C21.05 38.05 20.61 38.22 20.37 38.41 C17.95 40.33 15.52 42.24 13.1 44.16 C12.86 44.35 12.64 44.75 12.6 45.05 C12.42 46.6 12.43 48.3 12.5 50 C12.59 53.41 12.96 56.92 14.11 59.75 C14.23 60.03 14.52 60.41 14.76 60.6 C16.7 62.15 18.63 63.71 20.57 65.26 C20.81 65.45 21.24 65.64 21.54 65.69 C27.42 66.54 34.14 65.64 38.6 63.7 C40.28 62.97 41.77 61.82 43.01 60.39 C43.2 60.16 43.43 59.73 43.52 59.44 C44.61 55.94 45.7 52.43 46.79 48.93 C46.88 48.64 46.89 48.16 46.82 47.87 C46.19 45.29 45.56 42.71 44.93 40.13 C44.86 39.84 44.56 39.53 44.27 39.44 Z";
/**
 * 鼻の切れ込みがある一体の革のクッション。切れ込みはレンズの間を上り、ブリッジの金具の下端のすぐ下で止める。
 * 生地を余らせないよう、外側の上下の角はレンズの切り口と平行に切り、下辺はレンズの下に沿うまっすぐな線にする。
 * 鼻の切れ込みは鋭角の直線の山形にし、頂点はブリッジから吊るした三角の飾りの裏に隠す。
 * 革製品らしく、角はどれもレンズより大きく丸める。
 * レンズの間の上は革を切り欠き、ゴーグルの中央の上端をブリッジの金具にする。切り欠きの辺は、レンズの鼻側の
 * リムの縁をまっすぐ上へ延ばした線に、革の輪郭線の外側を合わせ、リムの角の丸みが出ないようにする。
 */
const CUSHION = "M43.92 37.26 C36.14 35.11 25.21 33.98 17.55 34.77 C16.24 34.95 14.32 35.77 13.29 36.59 C11.59 37.93 9.88 39.28 8.18 40.62 C7.15 41.44 6.25 43.19 6.2 44.51 C6.04 49.09 6.05 54.17 6.34 59.05 C6.43 60.36 7.34 62.11 8.37 62.94 C11.3 65.28 14.23 67.63 17.16 69.97 C18.19 70.8 20.09 71.29 21.4 71.07 C28.05 69.94 34.7 68.82 41.35 67.69 C42.32 67.53 43.47 66.66 43.9 65.77 C45.65 62.16 47.39 58.55 49.13 54.94 C49.61 53.95 50.39 53.95 50.87 54.94 C52.61 58.55 54.35 62.16 56.1 65.77 C56.53 66.66 57.68 67.53 58.65 67.69 C65.3 68.82 71.95 69.94 78.6 71.07 C79.91 71.29 81.81 70.8 82.84 69.97 C85.77 67.63 88.7 65.28 91.63 62.94 C92.66 62.11 93.57 60.36 93.66 59.05 C93.95 54.17 93.96 49.09 93.8 44.51 C93.75 43.19 92.85 41.44 91.82 40.62 C90.12 39.28 88.41 37.93 86.71 36.59 C85.68 35.77 83.76 34.95 82.45 34.77 C74.79 33.98 63.86 35.11 56.08 37.26 C55.66 37.38 55.23 37.83 55.12 38.26 L54.06 42.6 L45.94 42.6 L44.88 38.26 C44.77 37.83 44.34 37.38 43.92 37.26 Z";
/**
 * バンドの先の金属とリムをつなぐ四角いリング。塗りつぶさない金属の枠で、内側に後ろが見える。
 * 外側の角丸長方形と内側の穴を重ね、evenodd で枠だけを塗る。枠が線に埋もれないよう、輪郭線は細くする。
 */
const STRAP_RING = `${roundedRect(4, 47, 3.6, 7, 1.1)} ${roundedRect(5.2, 48.2, 1.2, 4.6, 0.4)}`;
/**
 * レンズの間に立つ鏡面の金具。上端は谷形で、ゴーグルの中央の上端になる。
 * 下はレンズの尖りの高さから左右の脚を下ろし、脚の下端を横棒で一体につなぐ。
 * 脚の間の窓は、左右の辺を蝶番の筒の内側の縁に合わせる。角は丸めずに立てる。
 * 左右の辺は、上はリムの縁をまっすぐ上へ延ばした線に合わせ、下はレンズのガラスとリムの金属の下に隠す。
 */
const BRIDGE_PLATE = "M46.13 39.34 L48 40 L50 40.9 L52 40 L53.87 39.34 L52.73 44 L53.8 46 L53.8 50.9 L46.2 50.9 L46.2 46 L47.27 44 Z M49.05 48.46 L50.95 48.46 L51.46 50.1 L48.54 50.1 Z";
/** 金具の上端。白い金属が背景に溶けないよう、細い線だけを引く。 */
const PLATE_TOP = "M46.13 39.34 L48 40 L50 40.9 L52 40 L53.87 39.34";
/** 金具の下端（横棒の下）。左右の辺はリムに沿うので線を引かない。 */
const PLATE_BOTTOM = "M47 50.9 L53 50.9";
/** 脚の間の窓の上と下の辺。左右の辺は蝶番の筒の内側の縁なので、線を引かない。 */
const PLATE_WINDOW_TOP = "M49.05 48.46 L50.95 48.46";
const PLATE_WINDOW_BOTTOM = "M48.54 50.1 L51.46 50.1";
/** リムの外側の黒い線のうち、金具より上でリムの縁の延長線より内へはみ出す所。ここだけ線を消し、縁をまっすぐに見せる。 */
const RIM_NOTCH = "M46.13 39.34 L43.85 30 L56.15 30 L53.87 39.34 L52 40 L50 40.9 L48 40 Z";
/**
 * 金具の左右の端にある蝶番の筒の切れ目。左目のレンズの鼻側の辺に沿う点と、外向きの向き。
 * 筒はレンズの尖りの上と下で分ける。
 */
const HINGE_SPLITS = [[45.88, 44, 0.971, -0.237], [46.95, 48.4, 1, 0.03]] as const;
/** 金具の下の横棒に頂点を掛けて吊るす、細長い二等辺三角形のクロームの飾り。頂点は金具の金属の面に当たる手前まで上げ、輪郭線の角を丸めて頂点の線が金具へ伸びないようにする。形が欠けないよう横棒の手前に描く。 */
const PENDANT = "M50 48.2 L52.81 58.34 L47.19 58.34 Z";
/** 三角の飾りに映る光の筋。ブリッジの金具と同じ向きと順で、細く強い筋の下に太く淡い筋を通す。 */
const PENDANT_GLINT_THIN = "M46 53 L54 49 L54 49.5 L46 53.5 Z";
const PENDANT_GLINT_WIDE = "M46 54.4 L54 50.4 L54 52 L46 56 Z";
/** 鏡面の金具に映る光の筋。細く強い筋と、太く淡い筋を斜めに通す。 */
const PLATE_GLINT_WIDE = "M43 47.7 L57 40.7 L57 43.1 L43 50.1 Z";
const PLATE_GLINT_THIN = "M43 45.7 L57 38.7 L57 39.5 L43 46.5 Z";
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
/** クッションの外側の下の角に沿う照り。下辺はレンズとの間が狭いので、角を回ったところで止める。 */
const CUSHION_LINE = "M8.8 57.4 C8.81 57.9 8.83 58.4 8.84 58.9 C8.87 60 9.61 61.46 10.47 62.14 C13.38 64.42 16.29 66.71 19.2 69";

/** 細部の量と線の太さ。detailed は OGP・ホーム画面用、simple はファビコンとサイト内の小さな表示用。 */
const LEVELS = {
    detailed: { ink: 1.4, cushionInk: 2.2, rim: 2.2, rimInk: 0.9, glassInk: 0.7, edgeBand: 3.4 },
    simple: { ink: 2.2, cushionInk: 3, rim: 2.8, rimInk: 1.4, glassInk: 1, edgeBand: 3 }
} as const;
type Level = keyof typeof LEVELS;

/** 鏡面の映り込みの色の並び。ブリッジの金具とほかの金属の部品で共有する。 */
const MIRROR_STOPS = `<stop offset="0" stop-color="#ffffff"/><stop offset=".2" stop-color="#eef1f4"/><stop offset=".36" stop-color="#b4bcc4"/>`
    + `<stop offset=".36" stop-color="#454c54"/><stop offset=".46" stop-color="#2b3036"/><stop offset=".6" stop-color="#9aa2aa"/>`
    + `<stop offset=".72" stop-color="#f6f8fa"/><stop offset=".84" stop-color="#c3c9cf"/><stop offset="1" stop-color="#626a72"/>`;

/**
 * 使うグラデーションとぼかし。detailed だけが空の映り込みとぼかしを使う。
 * レンズ（dome）は公式のゴーグルの色 #eca000 を中ほどに置き、光の当たる中心ほど明るく、縁ほど暗くする。
 * ブリッジの鏡面（mirror）は、上に空の白、地平線で急に暗く、下に地面の照り返しを映し、境目を硬くする。
 * mirror は透かしの金具全体で1つの映り込みになるよう、金具の上端から下端までの座標で指定する。
 * 三角の飾りとバンドの先の金属・リングは、同じ映り込みを部品ごとの外接矩形で使う（mirrorPart）。
 */
function gradientDefs(level: Level): string {
    const detailedOnly = level === "detailed"
        ? `<radialGradient id="sky" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
            + `<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".35"/></filter>`
        : "";
    return `<radialGradient id="dome" cx=".5" cy=".47" r=".62" fx=".4" fy=".3">`
        + `<stop offset="0" stop-color="#fff4d6"/><stop offset=".2" stop-color="#fed97c"/><stop offset=".48" stop-color="#f2ae1a"/>`
        + `<stop offset=".76" stop-color="#eca000"/><stop offset=".93" stop-color="#c98000"/><stop offset="1" stop-color="#a46000"/></radialGradient>`
        + `<linearGradient id="mirror" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="38.2" y2="55.4">${MIRROR_STOPS}</linearGradient>`
        + `<linearGradient id="mirrorPart" x1="0" x2="0" y1="0" y2="1">${MIRROR_STOPS}</linearGradient>`
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

/**
 * バンドの上下の縁の線。巻き付けた内側の点、横の端の点、端を出るときの向きのまま遠くまで伸ばした点。
 * @param side 左は -1、右は 1
 * @param y 平らな図での縁の高さ
 */
function strapEdge(side: -1 | 1, y: number): readonly [Point, Point, Point] {
    const at = warp([side < 0 ? 1.8 : 98.2, y]);
    const toward = warp([side < 0 ? 3.8 : 96.2, y]);
    const dx = at[0] - toward[0];
    const dy = at[1] - toward[1];
    const k = ((side < 0 ? -300 : 400) - at[0]) / dx;
    return [warp([side < 0 ? 14 : 86, y]), at, [at[0] + dx * k, at[1] + dy * k]];
}

/** バンドの縁の線の上で、巻き付けた後の横位置が x の点。 */
function strapEdgeAt(side: -1 | 1, y: number, x: number): Point {
    const [, at, far] = strapEdge(side, y);
    return lerp(at, far, (x - at[0]) / (far[0] - at[0]));
}

/**
 * バンド。先の金属の下から、横の端を出るときの向きのまま遠くまで伸ばす。端は先の金属が覆う。
 * 画像の枠（ファビコンの角丸、OGP の白い面、ロゴの枠）が端で切る。
 */
function strap(ink: number): string {
    let out = "";
    for (const side of [-1, 1] as const) {
        const top = strapEdge(side, 45.5);
        const bottom = strapEdge(side, 55.5);
        out += `<path d="M${[top[1], top[2], bottom[2], bottom[1]].map(pt).join("L")}Z" fill="#2b2b2b"/>`;
        for (const line of [top, bottom]) out += `<path d="M${[line[1], line[2]].map(pt).join("L")}" fill="none" stroke="${INK}" stroke-width="${num(ink * 1.4)}"/>`;
    }
    return out;
}

/**
 * バンドの先の金属。バンドの端を覆い、バンドよりわずかに太くして、外へ向けて山形に尖らせる。
 * 内側の端はリングの外側の棒の下に隠す。ブリッジの金具と同じ鏡面にし、detailed では光の筋も入れる。
 */
function strapTip(ink: number, detailed: boolean): string {
    let out = "";
    for (const side of [-1, 1] as const) {
        const [inner, shoulder, end] = side < 0 ? [8.6, 4.6, 3.3] : [91.4, 95.4, 96.7];
        const top = (x: number): Point => {
            const [px, py] = strapEdgeAt(side, 45.5, x);
            return [px, py - 0.3];
        };
        const bottom = (x: number): Point => {
            const [px, py] = strapEdgeAt(side, 55.5, x);
            return [px, py + 0.3];
        };
        const tipPoint = lerp(top(end), bottom(end), 0.5);
        const d = `M${[top(inner), top(shoulder), tipPoint, bottom(shoulder), bottom(inner)].map(pt).join("L")}Z`;
        out += `<path d="${d}" fill="url(#mirrorPart)"/>`;
        if (detailed) {
            // ブリッジの金具と同じ向きの光の筋。細く強い筋の下に太く淡い筋を通す。
            const [cx, cy] = lerp(tipPoint, lerp(top(inner), bottom(inner), 0.5), 0.5);
            const band = (offset: number, width: number) => {
                const at = (x: number, dy: number): Point => [x, cy + offset + dy - 0.5 * (x - cx)];
                return `M${[at(cx - 5, 0), at(cx + 5, 0), at(cx + 5, width), at(cx - 5, width)].map(pt).join("L")}Z`;
            };
            const id = side < 0 ? "tipClipL" : "tipClipR";
            out += `<clipPath id="${id}"><path d="${d}"/></clipPath>`
                + `<g clip-path="url(#${id})"><path d="${band(-0.4, 1.8)}" fill="#fff" opacity=".35"/><path d="${band(-1.6, 0.6)}" fill="#fff" opacity=".9"/></g>`;
        }
        out += `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${num(ink * 0.6)}" stroke-linejoin="round"/>`;
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
    // レンズの切り落とした角が立つよう、レンズとリムの線の角は丸めない。
    out += `<clipPath id="rimNotch"><path clip-rule="evenodd" d="M-500 -500 H600 V600 H-500 Z ${warpPath(RIM_NOTCH)}"/></clipPath>`;
    out += `<g clip-path="url(#rimNotch)">${useBoth(`fill="none" stroke="${INK}" stroke-width="${num(v.rim + v.rimInk * 2)}" stroke-linejoin="miter"`)}</g>`;
    out += useBoth(`fill="none" stroke="url(#gunmetal)" stroke-width="${v.rim}" stroke-linejoin="miter"`);
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
    out += useBoth(`fill="none" stroke="${INK}" stroke-width="${v.glassInk}" stroke-linejoin="miter"`);
    // 金具（クローム）: バンドの先の金属と、それをリムへつなぐリング。
    out += strapTip(v.ink, detailed);
    out += both(STRAP_RING, `fill="url(#mirrorPart)" fill-rule="evenodd" stroke="${INK}" stroke-width="${num(v.ink * 0.4)}" stroke-linejoin="round"`);
    // 金具はレンズのガラスとリムの金属より奥に見せる。リムの外側の黒い線の内側半分だけを残して隠し、境目の線にする。
    out += `<mask id="plateMask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>`
        + `${useBoth(`fill="#000" stroke="#000" stroke-width="${num(v.rim + v.rimInk)}" stroke-linejoin="miter"`)}</mask>`;
    let plate = path(BRIDGE_PLATE, `fill="url(#mirror)" fill-rule="evenodd"`);
    if (detailed) {
        out += `<clipPath id="plateClip"><path d="${warpPath(BRIDGE_PLATE)}" clip-rule="evenodd"/></clipPath>`;
        plate += `<g clip-path="url(#plateClip)">${path(PLATE_GLINT_WIDE, `fill="#fff" opacity=".35"`)}${path(PLATE_GLINT_THIN, `fill="#fff" opacity=".9"`)}</g>`;
    }
    if (detailed) {
        // 左右の端の蝶番: レンズの縁と同じ形の太さ違いの線を重ね、縁に沿う丸い筒の明暗にする。金具が細いので筒も細くする。
        const barrel = (distance: number, color: string) => useBoth(`fill="none" stroke="${color}" stroke-width="${num(distance * 2)}" stroke-linejoin="round"`);
        let hinge = barrel(2.3, INK) + barrel(2.12, "#5c646c") + barrel(1.98, "#aab1b8") + barrel(1.84, "#ffffff") + barrel(1.72, "#c6ccd2") + barrel(1.62, "#6b737b");
        for (const [x, y, nx, ny] of HINGE_SPLITS) {
            hinge += both(`M${num(x + nx * 1.5)} ${num(y + ny * 1.5)} L${num(x + nx * 2.3)} ${num(y + ny * 2.3)}`, `fill="none" stroke="${INK}" stroke-width=".35"`);
        }
        plate += `<g clip-path="url(#plateClip)">${hinge}</g>`;
    }
    plate += path(PLATE_TOP, `fill="none" stroke="${INK}" stroke-width="${num(v.ink * 0.2)}"`);
    plate += path(PLATE_WINDOW_TOP, `fill="none" stroke="${INK}" stroke-width="${num(v.ink * 0.7)}"`);
    plate += path(`${PLATE_WINDOW_BOTTOM} ${PLATE_BOTTOM}`, `fill="none" stroke="${INK}" stroke-width="${num(v.ink * 0.25)}"`);
    plate += path(PENDANT, `fill="url(#mirrorPart)"`);
    if (detailed) {
        out += `<clipPath id="pendantClip"><path d="${warpPath(PENDANT)}"/></clipPath>`;
        plate += `<g clip-path="url(#pendantClip)">${path(PENDANT_GLINT_WIDE, `fill="#fff" opacity=".35"`)}${path(PENDANT_GLINT_THIN, `fill="#fff" opacity=".9"`)}</g>`;
    }
    plate += path(PENDANT, `fill="none" stroke="${INK}" stroke-width="${num(v.ink * 0.25)}" stroke-linejoin="round"`);
    out += `<g mask="url(#plateMask)">${plate}</g>`;
    return out;
}

/** 巻き付けた本体（バンドを除く）の外接矩形。中央寄せと拡大率に使う。 */
const BODY_BOUNDS = warpedBounds([CUSHION, STRAP_RING, BRIDGE_PLATE]);

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

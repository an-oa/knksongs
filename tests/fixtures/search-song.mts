import { normalizeForSearch } from "../../app/lib/search-normalization.mts";
import { createSongFixture } from "./song.mts";

/**
 * 検索用の曲fixtureの入力。正規化済みの *Norm は元の値から作るため受け取らない。
 * 並び替え用の英名は Song に元の値を持たないため、専用の項目で受け取る。
 */
type SearchSongFixtureInput = Omit<
    Partial<Song>,
    "titleNorm" | "artistNorm" | "titleYomiNorm" | "artistYomiNorm" |
    "titleEnNorm" | "artistEnNorm" | "artistSortNorm"
> & {
    artistSort?: string;
};

/** 呼び出し元ごとに独立した連番を持つ検索用の曲fixture生成関数を作る。 */
export function createSearchSongFixtureFactory() {
    let autoSongId = 0;

    /** 曲キーと検索用の正規化済みフィールドを補って曲を作る。 */
    return function createSearchSongFixture(input: SearchSongFixtureInput): Song {
        const { artistSort = "", ...songInput } = input;
        const title = songInput.title ?? "";
        const artist = songInput.artist ?? "";
        const titleYomi = songInput.titleYomi ?? "";
        const artistYomi = songInput.artistYomi ?? "";
        const titleEn = songInput.titleEn ?? "";
        const artistEn = songInput.artistEn ?? "";
        const songKey = songInput.songKey ?? `song-${++autoSongId}`;
        return createSongFixture({
            ...songInput,
            archiveId: songInput.archiveId ?? "",
            archiveOrder: songInput.archiveOrder ?? 1,
            songKey,
            dateKey: songInput.dateKey ?? null,
            format: songInput.format ?? "配信",
            streamRole: songInput.streamRole ?? "",
            isRelay: !!songInput.isRelay,
            isHarmony: !!songInput.isHarmony,
            title,
            artist,
            titleYomi,
            artistYomi,
            titleEn,
            artistEn,
            titleNorm: normalizeForSearch(title),
            artistNorm: normalizeForSearch(artist),
            titleYomiNorm: normalizeForSearch(titleYomi),
            artistYomiNorm: normalizeForSearch(artistYomi),
            titleEnNorm: normalizeForSearch(titleEn),
            artistEnNorm: normalizeForSearch(artistEn),
            artistSortNorm: normalizeForSearch(artistSort)
        });
    };
}

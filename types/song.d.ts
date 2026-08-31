type VideoOrientation = "" | "vertical" | "landscape";

type Song = {
  date: string;
  dateKey: number | null;
  archiveId: string;
  archiveOrder: number;
  videoId: string;
  songKey: string;
  bookmarkSongKey: string;
  legacySongKey: string;
  format: string;
  streamRole: string;
  videoOrientation: VideoOrientation;
  isRelay: boolean;
  isHarmony: boolean;
  title: string;
  artist: string;
  titleYomi: string;
  artistYomi: string;
  url: string;
  endSeconds: number | null;
  titleNorm: string;
  artistNorm: string;
  titleYomiNorm: string;
  artistYomiNorm: string;
};

type SearchState = {
  queryRaw: string;
  dateFromKey: DateKey | null;
  dateToKey: DateKey | null;
  hasDateFilter: boolean;
  collabHostOnly?: boolean;
  collabGuestOnly?: boolean;
  relayOnly?: boolean;
  harmonyOnly?: boolean;
};

type SearchUiState = {
  el: import("../app/state.types").AppUiElements;
  search: import("../app/state.types").SearchUiRuntimeState;
  date: import("../app/state.types").DateUiRuntimeState;
  lookup: import("../app/state.types").LookupUiRuntimeState;
};

type SearchFiltersController = {
  areAllFormatsSelected: () => boolean;
  areFormatsDefault: () => boolean;
};

type SearchControllerCallbacks = {
  updateDisplay: () => void;
  scrollResultsPaneToTop: () => void;
  getRecommendedDisplayCount?: () => number;
  getInitialDisplayCount?: (defaultCount: number) => number;
};

type SearchDataState = import("../app/state.types").AppDataState;

type SearchConstants = {
  RANDOM_DISPLAY_COUNT: number;
  MIN_PERFORMANCE_FOR_RANDOM: number;
  RESULT_DISPLAY_BATCH_SIZE: number;
  DEFAULT_FORMATS?: string[];
};

type SearchInput = {
  searchState: SearchState;
  parsedQuery: import("../app/lib/search-query.mjs").ParsedSearchQuery;
};

type SearchControllerInput = {
  data: SearchDataState;
  ui: SearchUiState;
  searchFiltersController: SearchFiltersController;
  dateFilterController: ReturnType<typeof import("../app/ui/date/filter.mjs").createDateFilterController>;
  constants: SearchConstants;
  callbacks: SearchControllerCallbacks;
};

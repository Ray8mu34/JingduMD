export type OpenTarget = { root: string; selectedFile: string | null };
export type DirectoryEntry = { name: string; path: string; kind: "directory" | "markdown"; hasChildren: boolean };
export type OutlineItem = { level: number; text: string; id: string };
export type DocumentPayload = { path: string; name: string; content: string; modifiedMs: number; size: number };
export type SearchResult = { path: string; name: string; snippet: string; score: number };
export type SearchResponse = { results: SearchResult[]; partial: boolean; mode: "empty" | "index" | "scan" };
export type SystemFont = { family: string; supportsCjk: boolean; supportsLatin: boolean };

export type ReaderThemeId =
  | "paper" | "humanist" | "chinese" | "editorial" | "swiss"
  | "modern-textbook" | "solarized" | "night" | "nord" | "eink" | "technical";

export type ReadingRecipe = {
  theme: ReaderThemeId;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  paragraphSpacing: number;
  fontFamily: "serif" | "sans";
  headingFont: string;
  codeFont: string;
  headingScale: number;
  headingDensity: "compact" | "balanced" | "airy";
  paragraphStyle: "spacing" | "indent";
  firstLineIndent: number;
  textAlign: "left" | "justify";
  letterSpacing: number;
  quoteStyle: "bar" | "card" | "editorial";
  tableStyle: "plain" | "striped" | "compact";
  codeWrap: boolean;
  codeScale: number;
  formulaScale: number;
  imageBrightness: number;
  imageStyle: "soft" | "plain" | "bordered";
  backgroundWarmth: number;
  textContrast: number;
  readingFocus: "off" | "ruler" | "paragraph";
  showFrontmatter: boolean;
  showReadingStats: boolean;
};

export type CustomReaderProfile = {
  id: string;
  name: string;
  recipe: ReadingRecipe;
};

export type ReaderPreferences = ReadingRecipe & {
  chineseFont: string;
  latinFont: string;
  showTree: boolean;
  showOutline: boolean;
  readingRuler: boolean;
  remoteImagePolicy: "ask" | "allow" | "block";
  pdfStyle: "paper" | "current";
  pdfIncludeHighlights: boolean;
  allowedRemoteHosts: string[];
  favoriteFonts: string[];
  recentFonts: string[];
  customProfiles: CustomReaderProfile[];
};
export type ReadingPosition = { path: string; headingId: string | null; headingRatio: number; documentRatio: number };
export type IndexStatus = { root: string; indexed: number; total: number; running: boolean; error: string | null; phase: "idle" | "index" | "rebuild" | "complete" | "cancelled"; cancelled: boolean };
export type IndexDiagnostics = { schemaVersion: number; databaseBytes: number; indexedDocuments: number; indexedRoots: number; highlightCount: number; storesRawContent: boolean; currentRoot: string | null; status: IndexStatus };
export type RecentRoot = { path: string; openedMs: number };
export type ExternalChangeEvent = { path: string; kind: string };
export type AssetPayload = { mime: string; data: number[] };
export type HighlightColor = "yellow" | "green" | "blue" | "pink";
export type TextHighlight = {
  id: number;
  path: string;
  root: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  headingId: string | null;
  color: HighlightColor;
  createdMs: number;
  updatedMs: number;
};
export type NewTextHighlight = Omit<TextHighlight, "id" | "root" | "createdMs" | "updatedMs">;
export type ResolvedHighlight = TextHighlight & { range: Range | null; orphaned: boolean };

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  theme: "paper", fontSize: 18.5, lineHeight: 1.82, contentWidth: 780,
  paragraphSpacing: 0.85, fontFamily: "serif", showTree: true,
  chineseFont: "", latinFont: "", showOutline: true, readingRuler: false,
  headingFont: "", codeFont: "", headingScale: 1, headingDensity: "balanced",
  paragraphStyle: "spacing", firstLineIndent: 2, textAlign: "left", letterSpacing: 0,
  quoteStyle: "bar", tableStyle: "plain", codeWrap: false, codeScale: 0.84,
  formulaScale: 1, imageBrightness: 100, imageStyle: "soft", backgroundWarmth: 0,
  textContrast: 0, readingFocus: "off", showFrontmatter: true, showReadingStats: true,
  remoteImagePolicy: "ask", pdfStyle: "paper", pdfIncludeHighlights: true, allowedRemoteHosts: [], favoriteFonts: [], recentFonts: [], customProfiles: []
};

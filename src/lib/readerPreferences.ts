import type {
  AppearanceId, CustomReaderProfile, ReaderPreferences, ReaderThemeId, ReadingRecipe, TypographyOverride, TypographyProfileId
} from "../types";
import { DEFAULT_PREFERENCES } from "../types";

export type ReaderPreset = {
  id: ReaderThemeId;
  name: string;
  description: string;
  category: "人文" | "出版" | "现代" | "技术" | "夜间";
  dark: boolean;
  swatches: [string, string, string];
  recipe: ReadingRecipe;
};

const baseRecipe: ReadingRecipe = {
  theme: "paper",
  fontSize: DEFAULT_PREFERENCES.fontSize,
  lineHeight: DEFAULT_PREFERENCES.lineHeight,
  contentWidth: DEFAULT_PREFERENCES.contentWidth,
  paragraphSpacing: DEFAULT_PREFERENCES.paragraphSpacing,
  fontFamily: DEFAULT_PREFERENCES.fontFamily,
  headingFont: DEFAULT_PREFERENCES.headingFont,
  codeFont: DEFAULT_PREFERENCES.codeFont,
  headingScale: DEFAULT_PREFERENCES.headingScale,
  headingDensity: DEFAULT_PREFERENCES.headingDensity,
  paragraphStyle: DEFAULT_PREFERENCES.paragraphStyle,
  firstLineIndent: DEFAULT_PREFERENCES.firstLineIndent,
  textAlign: DEFAULT_PREFERENCES.textAlign,
  letterSpacing: DEFAULT_PREFERENCES.letterSpacing,
  quoteStyle: DEFAULT_PREFERENCES.quoteStyle,
  tableStyle: DEFAULT_PREFERENCES.tableStyle,
  codeWrap: DEFAULT_PREFERENCES.codeWrap,
  codeScale: DEFAULT_PREFERENCES.codeScale,
  formulaScale: DEFAULT_PREFERENCES.formulaScale,
  imageBrightness: DEFAULT_PREFERENCES.imageBrightness,
  imageStyle: DEFAULT_PREFERENCES.imageStyle,
  backgroundWarmth: DEFAULT_PREFERENCES.backgroundWarmth,
  textContrast: DEFAULT_PREFERENCES.textContrast,
  readingFocus: DEFAULT_PREFERENCES.readingFocus,
  showFrontmatter: DEFAULT_PREFERENCES.showFrontmatter,
  showReadingStats: DEFAULT_PREFERENCES.showReadingStats
};

function recipe(theme: ReaderThemeId, values: Partial<ReadingRecipe> = {}): ReadingRecipe {
  return { ...baseRecipe, theme, ...values };
}

export const READER_PRESETS: ReaderPreset[] = [
  {
    id: "paper", name: "静读暖纸", description: "温和纸色与均衡行距，适合日常长读", category: "人文", dark: false,
    swatches: ["#f6f2e8", "#504a43", "#466c75"], recipe: recipe("paper")
  },
  {
    id: "humanist", name: "人文暖页", description: "大留白、陶土强调与编辑式标题", category: "人文", dark: false,
    swatches: ["#f5eee6", "#493e35", "#c65f3c"], recipe: recipe("humanist", {
      fontSize: 19, lineHeight: 1.88, contentWidth: 760, paragraphSpacing: 1,
      headingScale: 1.08, headingDensity: "airy", letterSpacing: 0.006,
      quoteStyle: "card", imageStyle: "plain", backgroundWarmth: 5
    })
  },
  {
    id: "chinese", name: "中文书页", description: "宋体节奏、首行缩进与克制段距", category: "出版", dark: false,
    swatches: ["#f3efe4", "#3b3832", "#8b4139"], recipe: recipe("chinese", {
      fontSize: 19, lineHeight: 1.92, contentWidth: 740, paragraphSpacing: 0.28,
      headingScale: 1.02, paragraphStyle: "indent", firstLineIndent: 2,
      textAlign: "justify", letterSpacing: 0.015, quoteStyle: "editorial",
      imageStyle: "plain", backgroundWarmth: 4
    })
  },
  {
    id: "editorial", name: "编辑部", description: "窄栏、高对比层级与出版物细节", category: "出版", dark: false,
    swatches: ["#fbfaf7", "#282624", "#9c2437"], recipe: recipe("editorial", {
      fontSize: 18.5, lineHeight: 1.76, contentWidth: 700, paragraphSpacing: 1.05,
      headingScale: 1.14, headingDensity: "airy", quoteStyle: "editorial",
      tableStyle: "plain", imageStyle: "bordered", textContrast: 6
    })
  },
  {
    id: "swiss", name: "瑞士现代", description: "中性网格、无衬线与清楚的信息密度", category: "现代", dark: false,
    swatches: ["#f7f7f4", "#20211f", "#df4032"], recipe: recipe("swiss", {
      fontSize: 18, lineHeight: 1.7, contentWidth: 780, paragraphSpacing: 0.9,
      fontFamily: "sans", headingScale: 0.98, headingDensity: "compact",
      tableStyle: "compact", imageStyle: "plain", textContrast: 5
    })
  },
  {
    id: "modern-textbook", name: "现代教材", description: "宽松无衬线正文、蓝色章节与纯净公式", category: "技术", dark: false,
    swatches: ["#ffffff", "#0a1628", "#2d4baf"], recipe: recipe("modern-textbook", {
      fontSize: 19.5, lineHeight: 1.78, contentWidth: 780, paragraphSpacing: 1.05,
      fontFamily: "sans", headingScale: 0.98, headingDensity: "airy",
      quoteStyle: "bar", tableStyle: "plain", codeScale: 0.84, formulaScale: 1.05,
      imageStyle: "plain", backgroundWarmth: 0, textContrast: 5
    })
  },
  {
    id: "solarized", name: "Solarized 研究", description: "精确低反差色板，兼顾正文、代码与公式", category: "技术", dark: false,
    swatches: ["#fdf6e3", "#657b83", "#268bd2"], recipe: recipe("solarized", {
      fontSize: 18, lineHeight: 1.8, contentWidth: 820, paragraphSpacing: 0.9,
      fontFamily: "sans", quoteStyle: "card", tableStyle: "striped",
      codeScale: 0.86, imageStyle: "bordered"
    })
  },
  {
    id: "eink", name: "墨水屏", description: "近灰阶、低装饰，专注纯文字内容", category: "人文", dark: false,
    swatches: ["#ebebe6", "#2c2c29", "#555650"], recipe: recipe("eink", {
      fontSize: 19, lineHeight: 1.86, contentWidth: 720, paragraphSpacing: 0.4,
      paragraphStyle: "indent", textAlign: "justify", quoteStyle: "editorial",
      imageStyle: "plain", textContrast: 7
    })
  },
  {
    id: "night", name: "静谧夜读", description: "温和黑灰与偏暖文字，适合叙事长文", category: "夜间", dark: true,
    swatches: ["#1c1f22", "#c4c0b9", "#83aebd"], recipe: recipe("night", {
      fontSize: 18.5, lineHeight: 1.86, contentWidth: 780, paragraphSpacing: 0.9,
      imageBrightness: 78, backgroundWarmth: 2
    })
  },
  {
    id: "nord", name: "Nord 极夜", description: "深蓝灰与低饱和冰色，安静而清晰", category: "夜间", dark: true,
    swatches: ["#2e3440", "#d8dee9", "#88c0d0"], recipe: recipe("nord", {
      fontSize: 18, lineHeight: 1.8, contentWidth: 820, paragraphSpacing: 0.9,
      fontFamily: "sans", quoteStyle: "card", tableStyle: "striped",
      imageBrightness: 74, codeScale: 0.86
    })
  },
  {
    id: "technical", name: "清晰技术", description: "宽栏、紧凑标题与高效代码浏览", category: "技术", dark: false,
    swatches: ["#f7f9fb", "#39434d", "#376f95"], recipe: recipe("technical", {
      fontSize: 18, lineHeight: 1.72, contentWidth: 920, paragraphSpacing: 0.82,
      fontFamily: "sans", headingScale: 0.96, headingDensity: "compact",
      tableStyle: "compact", codeScale: 0.88, imageStyle: "bordered"
    })
  }
];

export function findPreset(id: string): ReaderPreset {
  return READER_PRESETS.find((preset) => preset.id === id) ?? READER_PRESETS[0];
}

export function applyPreset(current: ReaderPreferences, id: ReaderThemeId): ReaderPreferences {
  return { ...current, styleMode: "legacy", ...findPreset(id).recipe, readingRuler: findPreset(id).recipe.readingFocus !== "off" };
}

const canonicalProfiles: Record<TypographyProfileId, TypographyOverride> = {
  reading: { lineHeight: 1.85, contentWidth: 760, paragraphSpacing: .88, headingDensity: "balanced", headingScale: .95, fontFamily: "serif", quoteStyle: "bar", tableStyle: "plain", imageStyle: "plain", paragraphStyle: "spacing", firstLineIndent: 2, textAlign: "left", letterSpacing: 0, codeWrap: false, codeScale: .84, formulaScale: 1, chineseFont: "", latinFont: "", headingFont: "", codeFont: "" },
  study: { lineHeight: 1.78, contentWidth: 760, paragraphSpacing: .66, headingDensity: "compact", headingScale: .91, fontFamily: "serif", quoteStyle: "bar", tableStyle: "plain", imageStyle: "plain", paragraphStyle: "spacing", firstLineIndent: 2, textAlign: "left", letterSpacing: 0, codeWrap: false, codeScale: .84, formulaScale: 1, chineseFont: "", latinFont: "", headingFont: "", codeFont: "" }
};
const appearanceThemes: Record<AppearanceId, ReaderThemeId> = { warm: "paper", white: "paper", night: "night", nord: "nord" };

export function resolveReadingStyle(value: ReaderPreferences): ReaderPreferences {
  if (value.styleMode === "legacy") return value;
  return {
    ...value,
    ...canonicalProfiles[value.typographyProfile],
    ...(value.typographyOverrides?.[value.typographyProfile] ?? {}),
    theme: appearanceThemes[value.appearance],
    fontSize: value.fontSize,
    imageBrightness: value.imageBrightness
  };
}

export function chooseTypographyProfile(value: ReaderPreferences, profile: TypographyProfileId): ReaderPreferences {
  return { ...value, styleMode: "canonical", typographyProfile: profile, imageBrightness: value.styleMode === "legacy" ? 100 : value.imageBrightness };
}

export function chooseAppearance(value: ReaderPreferences, appearance: AppearanceId): ReaderPreferences {
  return { ...value, styleMode: "canonical", appearance, imageBrightness: value.styleMode === "legacy" ? 100 : value.imageBrightness };
}

export function setTypographyOverride<K extends keyof TypographyOverride>(value: ReaderPreferences, key: K, next: TypographyOverride[K]): ReaderPreferences {
  return { ...value, styleMode: "canonical", imageBrightness: value.styleMode === "legacy" ? 100 : value.imageBrightness, typographyOverrides: {
    ...value.typographyOverrides,
    [value.typographyProfile]: { ...value.typographyOverrides[value.typographyProfile], [key]: next }
  } };
}

export function recipeFromPreferences(value: ReaderPreferences): ReadingRecipe {
  const result = {} as ReadingRecipe;
  for (const key of Object.keys(baseRecipe) as (keyof ReadingRecipe)[]) {
    (result as Record<keyof ReadingRecipe, ReadingRecipe[keyof ReadingRecipe]>)[key] = value[key];
  }
  return result;
}

function recipeEquals(left: ReadingRecipe, right: ReadingRecipe): boolean {
  return (Object.keys(baseRecipe) as (keyof ReadingRecipe)[]).every((key) => left[key] === right[key]);
}

export function isPresetModified(value: ReaderPreferences): boolean {
  return !recipeEquals(recipeFromPreferences(value), findPreset(value.theme).recipe);
}

export function matchingCustomProfile(value: ReaderPreferences): CustomReaderProfile | undefined {
  const current = recipeFromPreferences(value);
  return value.customProfiles.find((profile) => recipeEquals(current, profile.recipe));
}

export function migratePreferences(saved: Partial<ReaderPreferences> | null | undefined): ReaderPreferences {
  if (!saved) return DEFAULT_PREFERENCES;
  const knownTheme = READER_PRESETS.some((preset) => preset.id === saved.theme) ? saved.theme : "paper";
  const old = !saved.schemaVersion;
  const merged = { ...DEFAULT_PREFERENCES, ...saved, theme: knownTheme,
    schemaVersion: 2,
    styleMode: old || (saved.schemaVersion ?? 0) > 2 ? "legacy" : saved.styleMode === "canonical" ? "canonical" : "legacy",
    typographyProfile: saved.typographyProfile === "study" ? "study" : "reading",
    appearance: (["warm", "white", "night", "nord"] as const).includes(saved.appearance as AppearanceId) ? saved.appearance : "warm",
    showTree: saved.showTree ?? (old ? true : DEFAULT_PREFERENCES.showTree),
    showOutline: saved.showOutline ?? (old ? true : DEFAULT_PREFERENCES.showOutline),
    typographyOverrides: {
      reading: saved.typographyOverrides?.reading ?? {},
      study: saved.typographyOverrides?.study ?? {}
    },
    personalTypographies: Array.isArray(saved.personalTypographies) ? saved.personalTypographies : []
  } as ReaderPreferences;
  if (merged.readingRuler && (!saved.readingFocus || saved.readingFocus === "off")) merged.readingFocus = "ruler";
  merged.readingRuler = merged.readingFocus !== "off";
  merged.customProfiles = Array.isArray(saved.customProfiles) ? saved.customProfiles : [];
  return merged;
}

export function isDarkTheme(id: ReaderThemeId): boolean {
  return findPreset(id).dark;
}

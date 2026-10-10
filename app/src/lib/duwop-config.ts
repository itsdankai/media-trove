import type { Look } from "./theme";

export const duwopConfig: {
  /** localStorage key for the saved look. Give each app its own so two apps on one domain don't clash. */
  storageKey: string;
  /** What a first-time visitor sees. */
  defaultLook: Look;
  /** Theme ids users may pick, or "all". "custom" is the random palette roller. */
  themes: string[] | "all";
  /** Opt-in effects from add-on items (e.g. @duwop/popcorn), shown in the picker after the core ones. */
  extraEffects?: { id: string; name: string; note: string }[];
} = {
  storageKey: "mediatrove-look",
  defaultLook: { theme: "duskwood", effects: ["underglow", "ambient"], amoled: false, font: "inter" },
  themes: "all",
  extraEffects: [
    {
      id: "popcorn",
      name: "Popcorn rain",
      note: "Popcorn drifting down behind the page. It's a media tracker, after all.",
    },
  ],
};

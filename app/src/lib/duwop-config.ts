import type { Look } from "./theme";

export const duwopConfig: {
  /** localStorage key for the saved look. Give each app its own so two apps on one domain don't clash. */
  storageKey: string;
  /** What a first-time visitor sees. */
  defaultLook: Look;
  /** Theme ids users may pick, or "all". "custom" is the random palette roller. */
  themes: string[] | "all";
} = {
  storageKey: "mediatrove-look",
  defaultLook: { theme: "trove", effects: ["underglow", "ambient"], amoled: false, font: "inter" },
  themes: "all",
};

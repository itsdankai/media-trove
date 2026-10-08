// Settings → Appearance (2026-10-08). Each theme is a set of colour tokens in styles.css, selected by
// data-theme; effects are words in data-fx; AMOLED is data-amoled; the font is --app-font. All live on
// <html>. Saved on the server (so every device matches) and copied to localStorage so index.html can
// apply them before the app loads (no flash).

export const themes = [
  { id: "trove", name: "Trove", note: "Gold on deep ink. The original." },
  { id: "midnight", name: "Midnight", note: "Electric blue, late-night cinema." },
  { id: "ember", name: "Ember", note: "Warm orange glow." },
  { id: "forest", name: "Forest", note: "Deep green and emerald." },
  { id: "synthwave", name: "Synthwave", note: "Neon pink and cyan." },
  { id: "rose", name: "Rose", note: "Soft pink on plum." },
  { id: "arctic", name: "Arctic", note: "Ice blue on slate." },
  { id: "mono", name: "Mono", note: "Black and white, no colour." },
  { id: "daylight", name: "Daylight", note: "Light mode." },
] as const;

export const effects = [
  { id: "underglow", name: "Underglow", note: "Posters lift and glow in the theme's colour when you point at them." },
  { id: "ambient", name: "Ambient glow", note: "A soft wash of the theme's colours behind the page." },
  { id: "motion", name: "Drifting glow", note: "The ambient glow slowly moves. Needs Ambient glow." },
  { id: "shine", name: "Poster shine", note: "A sweep of light across a poster on hover." },
] as const;

/** Fonts from Google Fonts, loaded only when picked. Inter ships with the page; System needs no download. */
export const fonts = [
  // adjust: a font-size-adjust value that gives each font the same text width as Inter, so switching fonts
  // never reshapes the layout (measured 2026-10-08; JetBrains Mono was 19% wider, Outfit 9% narrower).
  { id: "inter", name: "Inter", family: "Inter", adjust: 0, note: "The default. Clean and neutral." },
  { id: "system", name: "System", family: "", adjust: 0.544, note: "Your device's own font. Nothing to download." },
  { id: "outfit", name: "Outfit", family: "Outfit", adjust: 0.534, note: "Round and friendly." },
  { id: "spacegrotesk", name: "Space Grotesk", family: "Space Grotesk", adjust: 0.5, note: "Techy, a bit quirky." },
  { id: "lexend", name: "Lexend", family: "Lexend", adjust: 0.528, note: "Wide and easy to read." },
  {
    id: "atkinson",
    name: "Atkinson Hyperlegible",
    family: "Atkinson Hyperlegible",
    adjust: 0.542,
    note: "Made for low vision.",
  },
  { id: "nunito", name: "Nunito", family: "Nunito", adjust: 0.53, note: "Soft rounded ends." },
  {
    id: "jetbrains",
    name: "JetBrains Mono",
    family: "JetBrains Mono",
    adjust: 0.46,
    note: "Monospace, for the nerds.",
  },
] as const;

export type Look = { theme: string; effects: string[]; amoled: boolean; font: string };

const KEY = "mediatrove-look";

/** Puts a look on the page now, and remembers it for the next load. */
export function applyLook(look: Look) {
  const html = document.documentElement;
  const font = fonts.find((f) => f.id === look.font) ?? fonts[0];
  const url =
    font.family && font.id !== "inter"
      ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@400;500;600;700&display=swap`
      : "";
  html.dataset.theme = look.theme;
  html.dataset.fx = look.effects.join(" ");
  html.classList.toggle("dark", look.theme !== "daylight");
  html.toggleAttribute("data-amoled", look.amoled);
  html.style.setProperty("--app-font", font.family ? `"${font.family}"` : "system-ui");
  if (font.adjust) html.style.setProperty("--app-font-adjust", String(font.adjust));
  else html.style.removeProperty("--app-font-adjust");
  loadFont(url);
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...look, family: font.family, adjust: font.adjust, url }));
  } catch {
    // Private windows can refuse storage; the server copy still applies once loaded.
  }
}

function loadFont(url: string) {
  let link = document.getElementById("app-font") as HTMLLinkElement | null;
  if (!url) return link?.remove();
  if (!link) {
    link = document.createElement("link");
    link.id = "app-font";
    link.rel = "stylesheet";
    document.head.append(link);
  }
  if (link.href !== url) link.href = url;
}

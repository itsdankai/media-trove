// Settings → Appearance (2026-10-08). Each theme is a set of colour tokens in styles.css, selected by
// data-theme; effects are words in data-fx. Both live on <html>. Saved on the server (so every device
// matches) and copied to localStorage so index.html can apply them before the app loads (no flash).

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

const KEY = "mediatrove-look";

/** Puts a theme and effects on the page now, and remembers them for the next load. */
export function applyLook(theme: string, fx: string[]) {
  const html = document.documentElement;
  html.dataset.theme = theme;
  html.dataset.fx = fx.join(" ");
  html.classList.toggle("dark", theme !== "daylight");
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme, fx }));
  } catch {
    // Private windows can refuse storage; the server copy still applies once loaded.
  }
}

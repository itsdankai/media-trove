// Reading uploads: ZIPs are unpacked in memory, CSVs are parsed into rows keyed by header.
import { strFromU8, unzipSync } from "fflate";
import { ImportUserError, type UploadFile } from "./types.ts";

const MAX_BYTES = 200 * 1024 * 1024; // unpacked; a big Trakt export is a few MB

/** Turns an uploaded file into the text files inside it (just itself unless it's a ZIP). */
export function readUpload(name: string, bytes: Uint8Array): UploadFile[] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (!isZip) return [{ name: baseName(name), text: strFromU8(bytes).replace(/^﻿/, "") }];
  let total = 0;
  const entries = unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_BYTES) throw new ImportUserError("That ZIP is too big to be an export file.");
      return /\.(json|csv)$/i.test(f.name) && !f.name.startsWith("__MACOSX/");
    },
  });
  const files = Object.entries(entries).map(([n, data]) => ({
    name: n,
    text: strFromU8(data).replace(/^﻿/, ""),
  }));
  if (!files.length) throw new ImportUserError("That ZIP has no JSON or CSV files in it.");
  return files;
}

export const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? path).toLowerCase();

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

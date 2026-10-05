// Encrypts plugin credentials at rest (AES-256-GCM). The key comes from MEDIATROVE_SECRET_KEY
// (32 bytes, base64) or is generated once into <data dir>/secret.key. Lose that file and every
// connection has to be signed in again — nothing else is affected.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadKey(dataDir: string) {
  const fromEnv = process.env.MEDIATROVE_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("MEDIATROVE_SECRET_KEY must be 32 bytes, base64-encoded");
    return key;
  }
  const file = join(dataDir, "secret.key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
}

export function encrypt(key: Buffer, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt<T = unknown>(key: Buffer, sealed: string): T {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("unreadable credentials");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}

import crypto from "node:crypto";
import { env } from "../env.js";

/**
 * AES-256-GCM at-rest encryption for the Xero refresh_token. The key comes
 * from XERO_ENCRYPTION_KEY (base64, 32 bytes). Ciphertext is stored as
 * "<iv_base64>.<tag_base64>.<ciphertext_base64>" so we can roll keys later
 * by prefixing a key id without changing the column type.
 */

const ALG = "aes-256-gcm";
const KEY = (() => {
  const buf = Buffer.from(env.XERO_ENCRYPTION_KEY, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `XERO_ENCRYPTION_KEY must decode to 32 bytes; got ${buf.length}. Run: openssl rand -base64 32`,
    );
  }
  return buf;
})();

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const [ivB64, tagB64, ctB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Invalid ciphertext format");
  }
  const decipher = crypto.createDecipheriv(ALG, KEY, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

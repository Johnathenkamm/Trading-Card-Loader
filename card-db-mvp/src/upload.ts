// Minimal, zero-dependency multipart/form-data parsing for image uploads.
//
// The urlencoded body reader in server.ts accumulates into a string, which
// corrupts binary image bytes. This reads the raw request as a Buffer and splits
// it on the MIME boundary, returning text fields and file parts separately.

import type { IncomingMessage } from "node:http";

export type UploadedFile = { field: string; filename: string; contentType: string; data: Buffer };
export type ParsedMultipart = { fields: Record<string, string>; files: UploadedFile[] };

/** Extract the boundary token from a `multipart/form-data; boundary=…` header. */
export function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]).trim() : null;
}

/** Collect the full request body as a Buffer, rejecting bodies over `limit`. */
export function readBodyBuffer(req: IncomingMessage, limit = 60_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const CRLFCRLF = Buffer.from("\r\n\r\n");

/**
 * Parse a multipart body. Walks boundary-delimited parts, splitting each into a
 * header block and a raw body; parts with a `filename` become files, the rest
 * become string fields. Binary-safe (operates on Buffers throughout).
 */
export function parseMultipart(buf: Buffer, boundary: string): ParsedMultipart {
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  const delim = Buffer.from(`--${boundary}`);

  let pos = buf.indexOf(delim);
  if (pos < 0) return { fields, files };
  pos += delim.length;

  while (pos < buf.length) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // closing "--"
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2; // CRLF after boundary

    const next = buf.indexOf(delim, pos);
    if (next < 0) break;
    let end = next;
    if (buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2; // strip trailing CRLF

    const part = buf.subarray(pos, end);
    const sep = part.indexOf(CRLFCRLF);
    if (sep >= 0) {
      const header = part.subarray(0, sep).toString("utf8");
      const body = part.subarray(sep + 4);
      const cd = /content-disposition:[^\r\n]*/i.exec(header)?.[0] ?? "";
      const name = /name="([^"]*)"/i.exec(cd)?.[1] ?? "";
      const fn = /filename="([^"]*)"/i.exec(cd);
      const ctype = /content-type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim();
      if (fn) {
        if (fn[1]) files.push({ field: name, filename: fn[1], contentType: ctype ?? "application/octet-stream", data: Buffer.from(body) });
      } else if (name) {
        fields[name] = body.toString("utf8");
      }
    }
    pos = next + delim.length;
  }
  return { fields, files };
}

const IMAGE_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif",
]);
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;

export function isImage(f: UploadedFile): boolean {
  return IMAGE_TYPES.has(f.contentType.toLowerCase()) || IMAGE_EXT.test(f.filename);
}

/**
 * Derive a text identify-hint from an image filename, or null when it's a
 * generic camera/scanner name (IMG_1234, DSC0001, a bare number) that carries no
 * signal. A named file like "charizard-4-102.jpg" becomes "charizard 4 102",
 * which the catalog matcher can identify — a real, useful bridge until a vision
 * model reads the pixels (see identify.ts).
 */
export function hintFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return null;
  if (/^(img|image|dsc|dscn|photo|pic|pxl|scan|screenshot|capture)\s*\d*$/i.test(base)) return null;
  if (/^\d+$/.test(base)) return null; // pure number
  if (!/[a-z]{3,}/i.test(base)) return null; // no real word
  return base;
}

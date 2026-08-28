// Image storage — the "bucket" layer.
//
// Structured card data lives in Postgres; the actual image FILES (especially
// seller-uploaded scan photos) live in object storage. Postgres stores only the
// key/URL string. This module abstracts that store behind one interface with two
// drivers:
//
//   local -> writes under ./data/uploads         (zero dependencies; dev default)
//   s3    -> any S3-compatible bucket: MinIO (bundled), AWS S3, Cloudflare R2,
//            or Supabase Storage's S3 endpoint    (needs: npm i @aws-sdk/client-s3)
//
// Switching drivers/hosts is env-only (see .env.example) — no code changes.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { randomUUID } from "node:crypto";

export type PutResult = { key: string; url: string };

export interface Storage {
  /** Store bytes under `key`; returns the key and a public URL. */
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<PutResult>;
  /** Public URL for an existing key. */
  url(key: string): string;
}

/** Namespaced object key for a seller upload, e.g. sellers/1/scan/<uuid>.jpg */
export function keyFor(sellerId: number, filename: string, folder = "scan"): string {
  const ext = (extname(filename) || ".jpg").toLowerCase();
  return `sellers/${sellerId}/${folder}/${randomUUID()}${ext}`;
}

// ---- local filesystem driver ----------------------------------------------

class LocalStorage implements Storage {
  private dir: string;
  private publicBase: string;
  constructor(dir: string, publicBase: string) {
    this.dir = dir;
    this.publicBase = publicBase;
  }

  async put(key: string, data: Buffer | Uint8Array): Promise<PutResult> {
    const full = join(this.dir, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return { key, url: this.url(key) };
  }

  url(key: string): string {
    return `${this.publicBase.replace(/\/+$/, "")}/${key}`;
  }
}

// ---- S3-compatible driver (MinIO / S3 / R2 / Supabase) --------------------

type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBase: string;
};

class S3Storage implements Storage {
  private client: any;
  private mod: any;
  private cfg: S3Config;
  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  private async ensure(): Promise<void> {
    if (this.client) return;
    try {
      this.mod = await import("@aws-sdk/client-s3");
    } catch {
      throw new Error("STORAGE_DRIVER=s3 requires the AWS SDK: npm i @aws-sdk/client-s3");
    }
    this.client = new this.mod.S3Client({
      endpoint: this.cfg.endpoint,
      region: this.cfg.region,
      forcePathStyle: this.cfg.forcePathStyle,
      credentials: {
        accessKeyId: this.cfg.accessKeyId,
        secretAccessKey: this.cfg.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<PutResult> {
    await this.ensure();
    await this.client.send(
      new this.mod.PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return { key, url: this.url(key) };
  }

  url(key: string): string {
    return `${this.cfg.publicBase.replace(/\/+$/, "")}/${key}`;
  }
}

// ---- factory --------------------------------------------------------------

/** The on-disk uploads directory when using the local driver, else null (S3
 *  URLs are absolute and served by the bucket, not this app). */
export function localUploadsDir(): string | null {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver !== "local") return null;
  return process.env.STORAGE_LOCAL_DIR ?? "./data/uploads";
}

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif", ".avif": "image/avif",
};
export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE[ext.toLowerCase()] ?? "application/octet-stream";
}

let _storage: Storage | null = null;

export function storage(): Storage {
  if (_storage) return _storage;
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver === "s3") {
    _storage = new S3Storage({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "card-images",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
      publicBase: process.env.S3_PUBLIC_BASE ?? "http://localhost:9000/card-images",
    });
  } else {
    _storage = new LocalStorage(
      process.env.STORAGE_LOCAL_DIR ?? "./data/uploads",
      process.env.STORAGE_PUBLIC_BASE ?? "/uploads"
    );
  }
  return _storage;
}

import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Storage abstraction for chunked, resumable uploads.
 * Parts are idempotent: re-sending a part number overwrites it, which is what
 * makes crash recovery safe on the client.
 */
export interface StorageDriver {
  begin(key: string, mimeType: string): Promise<string | null>;
  putPart(key: string, uploadId: string | null, partNumber: number, body: Uint8Array): Promise<string | null>;
  complete(key: string, uploadId: string | null, parts: { partNumber: number; etag: string | null }[]): Promise<number>;
  abort(key: string, uploadId: string | null): Promise<void>;
  delete(key: string): Promise<void>;
  /** A URL the browser can play directly, or null to stream through /api/videos/:id/stream. */
  playbackUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
  /** Writes a small object (a few MB at most) in one go, replacing any earlier one. */
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Reads a small object whole, or null when there's none. */
  getObject(key: string): Promise<Buffer | null>;
  /**
   * Object storage only: a short-lived URL the browser can PUT one part to
   * directly, so video bytes never pass through our servers (or their
   * request-size limits). The part's exact size is signed into the URL.
   */
  presignPart?(key: string, uploadId: string | null, partNumber: number, size: number): Promise<string>;
  /**
   * Object storage only: a short-lived URL the browser can PUT one small object of exactly `size` bytes to
   * (a recording's piece, lib/pieces.ts).
   */
  presignObject?(key: string, size: number): Promise<string>;
  /** Object storage only: the parts actually stored, as the source of truth at completion. */
  listParts?(key: string, uploadId: string | null): Promise<{ partNumber: number; etag: string | null; sizeBytes: number }[]>;
  /** Object storage only: the size of a finished object, or null when there's none. */
  storedSize?(key: string): Promise<number | null>;
  /** Local driver only: open a byte range of the finished file. */
  open?(key: string, range?: { start: number; end: number }): Promise<{ stream: ReadableStream; size: number }>;
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}

  private file(key: string) {
    return path.join(this.root, key);
  }
  private partsDir(key: string) {
    return this.file(key) + ".parts";
  }

  async begin(key: string) {
    await fs.mkdir(this.partsDir(key), { recursive: true });
    return null;
  }

  async putPart(key: string, _uploadId: string | null, partNumber: number, body: Uint8Array) {
    const dir = this.partsDir(key);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${partNumber}.tmp`);
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, path.join(dir, String(partNumber)));
    return null;
  }

  async complete(key: string, _uploadId: string | null, parts: { partNumber: number }[]) {
    const out = this.file(key);
    // Built beside the file and moved into place, so a second finish racing this one can't cut it short.
    const tmp = `${out}.${randomUUID()}.tmp`;
    const handle = await fs.open(tmp, "w");
    let size = 0;
    try {
      for (const { partNumber } of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
        const buf = await fs.readFile(path.join(this.partsDir(key), String(partNumber)));
        await handle.write(buf);
        size += buf.length;
      }
    } catch (err) {
      await handle.close();
      await fs.rm(tmp, { force: true });
      // The other finish got there first and tidied the parts away.
      const done = (err as NodeJS.ErrnoException).code === "ENOENT" ? await fs.stat(out).catch(() => null) : null;
      if (done) return done.size;
      throw err;
    }
    await handle.close();
    await fs.rename(tmp, out);
    await fs.rm(this.partsDir(key), { recursive: true, force: true });
    return size;
  }

  async abort(key: string) {
    await fs.rm(this.partsDir(key), { recursive: true, force: true });
  }

  async delete(key: string) {
    await this.abort(key);
    await fs.rm(this.file(key), { force: true });
  }

  async playbackUrl() {
    return null;
  }

  async putObject(key: string, body: Uint8Array) {
    const file = this.file(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + ".tmp", body);
    await fs.rename(file + ".tmp", file);
  }

  async getObject(key: string) {
    return fs.readFile(this.file(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
  }

  async open(key: string, range?: { start: number; end: number }) {
    const file = this.file(key);
    const { size } = await fs.stat(file);
    const node = createReadStream(file, range ? { start: range.start, end: range.end } : undefined);
    const stream = new ReadableStream({
      start(controller) {
        node.on("data", (c) => controller.enqueue(new Uint8Array(c as Buffer)));
        node.on("end", () => controller.close());
        node.on("error", (e) => controller.error(e));
      },
      cancel() {
        node.destroy();
      },
    });
    return { stream, size };
  }
}

class S3Driver implements StorageDriver {
  private s3: S3Client;
  constructor(private bucket: string) {
    this.s3 = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT || undefined, // set for Cloudflare R2
      forcePathStyle: !!process.env.S3_ENDPOINT,
      // Otherwise the SDK signs a checksum of an empty body into every presigned
      // part URL, which a bucket that checks it would refuse for the real part.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async begin(key: string, mimeType: string) {
    const res = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }),
    );
    return res.UploadId ?? null;
  }

  async putPart(key: string, uploadId: string | null, partNumber: number, body: Uint8Array) {
    const res = await this.s3.send(
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId!, PartNumber: partNumber, Body: body }),
    );
    return res.ETag ?? null;
  }

  async complete(key: string, uploadId: string | null, parts: { partNumber: number; etag: string | null }[]) {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId!,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag! })),
        },
      }),
    );
    return -1; // size is tracked from parts by the caller
  }

  async presignPart(key: string, uploadId: string | null, partNumber: number, size: number) {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId!, PartNumber: partNumber, ContentLength: size }),
      { expiresIn: 15 * 60, signableHeaders: new Set(["content-length"]) },
    );
  }

  async presignObject(key: string, size: number) {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: size }), {
      expiresIn: 15 * 60,
      signableHeaders: new Set(["content-length"]),
    });
  }

  async listParts(key: string, uploadId: string | null) {
    const out: { partNumber: number; etag: string | null; sizeBytes: number }[] = [];
    let marker: string | undefined;
    do {
      const res = await this.s3.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId!, PartNumberMarker: marker }));
      for (const p of res.Parts ?? []) out.push({ partNumber: p.PartNumber!, etag: p.ETag ?? null, sizeBytes: Number(p.Size ?? 0) });
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    return out;
  }

  async storedSize(key: string) {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return Number(res.ContentLength ?? 0);
    } catch (err) {
      if ((err as { name?: string })?.name === "NotFound" || err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async abort(key: string, uploadId: string | null) {
    if (!uploadId) return;
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async playbackUrl(key: string, expiresInSeconds = 60 * 60) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async getObject(key: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }
}

/**
 * Keeps video bytes in Postgres, one row per upload part. For previews and
 * small deployments on hosts with no writable disk (e.g. Vercel) and no S3/R2
 * bucket yet. Ranges are served by reading only the parts they touch.
 */
class DbDriver implements StorageDriver {
  private async db() {
    return (await import("@/lib/db")).db;
  }

  async begin() {
    return null;
  }

  async putPart(key: string, _uploadId: string | null, partNumber: number, body: Uint8Array) {
    const db = await this.db();
    const data = Buffer.from(body);
    await db.storedPart.upsert({
      where: { key_partNumber: { key, partNumber } },
      create: { key, partNumber, size: data.length, data },
      update: { size: data.length, data },
    });
    return null;
  }

  async complete(key: string, _uploadId: string | null, parts: { partNumber: number }[]) {
    const db = await this.db();
    const keep = parts.map((p) => p.partNumber);
    await db.storedPart.deleteMany({ where: { key, partNumber: { notIn: keep } } });
    const sum = await db.storedPart.aggregate({ where: { key }, _sum: { size: true } });
    return sum._sum.size ?? 0;
  }

  async abort(key: string) {
    await this.delete(key);
  }

  async delete(key: string) {
    const db = await this.db();
    await db.storedPart.deleteMany({ where: { key } });
  }

  async playbackUrl() {
    return null;
  }

  async putObject(key: string, body: Uint8Array) {
    const db = await this.db();
    const data = Buffer.from(body);
    await db.$transaction([
      db.storedPart.deleteMany({ where: { key, partNumber: { not: 1 } } }),
      db.storedPart.upsert({ where: { key_partNumber: { key, partNumber: 1 } }, create: { key, partNumber: 1, size: data.length, data }, update: { size: data.length, data } }),
    ]);
  }

  async getObject(key: string) {
    const db = await this.db();
    const parts = await db.storedPart.findMany({ where: { key }, orderBy: { partNumber: "asc" }, select: { data: true } });
    return parts.length ? Buffer.concat(parts.map((p) => p.data)) : null;
  }

  async open(key: string, range?: { start: number; end: number }) {
    const db = await this.db();
    const index = await db.storedPart.findMany({ where: { key }, select: { partNumber: true, size: true }, orderBy: { partNumber: "asc" } });
    const size = index.reduce((n, p) => n + p.size, 0);
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    // Parts overlapping [start, end], with each one's offset in the file.
    const wanted: { partNumber: number; offset: number; size: number }[] = [];
    let offset = 0;
    for (const p of index) {
      if (offset + p.size > start && offset <= end) wanted.push({ ...p, offset });
      offset += p.size;
    }
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const p = wanted[i++];
        if (!p) return controller.close();
        const row = await db.storedPart.findUniqueOrThrow({ where: { key_partNumber: { key, partNumber: p.partNumber } }, select: { data: true } });
        const from = Math.max(0, start - p.offset);
        const to = Math.min(p.size, end - p.offset + 1);
        controller.enqueue(new Uint8Array(row.data.subarray(from, to)));
      },
    });
    return { stream, size };
  }
}

let driver: StorageDriver | undefined;

/**
 * S3/R2 when S3_BUCKET is set. Otherwise Postgres on hosts without a
 * writable disk (Vercel) or when STORAGE_DRIVER=db, else local files.
 */
export function storageKind(): "s3" | "db" | "local" {
  if (process.env.S3_BUCKET) return "s3";
  return process.env.STORAGE_DRIVER === "db" || (process.env.VERCEL && process.env.STORAGE_DRIVER !== "local") ? "db" : "local";
}

export function storage(): StorageDriver {
  if (!driver) {
    const kind = storageKind();
    driver =
      kind === "s3"
        ? new S3Driver(process.env.S3_BUCKET!)
        : kind === "db"
          ? new DbDriver()
          : new LocalDriver(path.resolve(process.env.LOCAL_STORAGE_DIR ?? ".data/uploads"));
  }
  return driver;
}

/** S3 requires every multipart part except the last to be at least 5 MiB. */
export const MIN_PART_BYTES = 5 * 1024 * 1024;

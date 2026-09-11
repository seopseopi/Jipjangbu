interface R2ListOptions {
  include?: Array<"httpMetadata" | "customMetadata">;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BACKUPS: R2Bucket;
  }
}

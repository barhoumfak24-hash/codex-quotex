// Document storage. S3-compatible: AWS S3, Cloudflare R2, MinIO.
// Production: encrypt at rest (SSE-KMS), restrict bucket policy, sign URLs short-lived.

function assertDevelopmentStorageFallbackAllowed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("document_storage_not_configured");
  }
}

export async function presignUpload(_args: {
  tenantId: string;
  fileName: string;
  contentType: string;
}): Promise<{ url: string; key: string }> {
  assertDevelopmentStorageFallbackAllowed();
  // Real: s3.getSignedUrlPromise('putObject', { Bucket, Key, ContentType, Expires: 60 })
  return { url: "https://example.s3.amazonaws.com/stub-upload", key: "stub-key" };
}

export async function presignDownload(_key: string): Promise<string> {
  assertDevelopmentStorageFallbackAllowed();
  return "https://example.s3.amazonaws.com/stub-download";
}

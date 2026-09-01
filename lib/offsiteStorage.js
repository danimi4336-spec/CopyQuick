const fs = require('fs');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const DEFAULT_CONNECTION_TIMEOUT_MS = 5 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_LISTED_OBJECTS = 10 * 1000;
const MAX_CONNECTION_TIMEOUT_MS = 30 * 1000;
const MAX_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_LISTED_OBJECTS = 100 * 1000;
const MAX_LIST_PAGES = 1000;

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function resolveOffsiteTransportConfig(env = process.env) {
  return Object.freeze({
    connectionTimeoutMs: boundedInteger(
      env.OFFSITE_STORAGE_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
      1000,
      MAX_CONNECTION_TIMEOUT_MS
    ),
    requestTimeoutMs: boundedInteger(
      env.OFFSITE_STORAGE_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      5000,
      MAX_REQUEST_TIMEOUT_MS
    ),
    maxAttempts: boundedInteger(
      env.OFFSITE_STORAGE_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
      MAX_ATTEMPTS
    ),
    maxListedObjects: boundedInteger(
      env.OFFSITE_STORAGE_MAX_LISTED_OBJECTS,
      DEFAULT_MAX_LISTED_OBJECTS,
      100,
      MAX_LISTED_OBJECTS
    )
  });
}

function createOffsiteStorageClient({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  forcePathStyle = true,
  env = process.env,
  S3ClientApi = S3Client,
  NodeHttpHandlerApi = NodeHttpHandler
}) {
  const transport = resolveOffsiteTransportConfig(env);
  return new S3ClientApi({
    endpoint: endpoint || undefined,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: transport.maxAttempts,
    requestHandler: new NodeHttpHandlerApi({
      connectionTimeout: transport.connectionTimeoutMs,
      requestTimeout: transport.requestTimeoutMs,
      throwOnRequestTimeout: true
    })
  });
}

class OffsiteStorageError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OffsiteStorageError';
    this.code = code;
  }
}

class S3CompatibleStorage {
  constructor({
    endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle = true,
    client, env, maxListedObjects
  }) {
    this.bucket = bucket;
    const transport = resolveOffsiteTransportConfig(env);
    this.maxListedObjects = boundedInteger(
      maxListedObjects,
      transport.maxListedObjects,
      1,
      MAX_LISTED_OBJECTS
    );
    this.client = client || createOffsiteStorageClient({
      endpoint, region, accessKeyId, secretAccessKey, forcePathStyle, env
    });
  }

  async putObject({ key, filePath, sizeBytes, metadata }) {
    return this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentLength: sizeBytes,
      ContentType: 'application/octet-stream',
      Metadata: metadata,
      IfNoneMatch: '*'
    }));
  }

  async headObject(key) {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { sizeBytes: Number(result.ContentLength), metadata: result.Metadata || {} };
  }

  async getObject(key, { expectedSize, maxBytes }) {
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || expectedSize > maxBytes) {
      throw new OffsiteStorageError('Remote backup download bounds are invalid.', 'REMOTE_DOWNLOAD_BOUNDS_INVALID');
    }
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new OffsiteStorageError('Remote backup object has no body.', 'REMOTE_OBJECT_EMPTY');
    if (!result.Body[Symbol.asyncIterator]) {
      throw new OffsiteStorageError('Remote backup body is not safely streamable.', 'REMOTE_OBJECT_STREAM_UNAVAILABLE');
    }
    const chunks = [];
    let received = 0;
    try {
      for await (const chunk of result.Body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.length;
        if (received > maxBytes || received > expectedSize) {
          if (typeof result.Body.destroy === 'function') result.Body.destroy();
          throw new OffsiteStorageError('Remote backup exceeded its verified size.', 'REMOTE_OBJECT_SIZE_EXCEEDED');
        }
        chunks.push(buffer);
      }
    } catch (error) {
      if (error instanceof OffsiteStorageError) throw error;
      throw new OffsiteStorageError('Remote backup download failed.', 'REMOTE_DOWNLOAD_FAILED', error);
    }
    if (received !== expectedSize) {
      throw new OffsiteStorageError('Remote backup size did not match HEAD metadata.', 'REMOTE_OBJECT_SIZE_MISMATCH');
    }
    return Buffer.concat(chunks, received);
  }

  async listObjects(prefix) {
    const objects = [];
    let continuationToken;
    let pageCount = 0;
    const seenTokens = new Set();
    do {
      if (continuationToken) {
        if (seenTokens.has(continuationToken)) {
          throw new OffsiteStorageError('Remote listing pagination repeated.', 'REMOTE_LIST_PAGINATION_INVALID');
        }
        seenTokens.add(continuationToken);
      }
      pageCount += 1;
      if (pageCount > MAX_LIST_PAGES) {
        throw new OffsiteStorageError('Remote listing exceeded its page limit.', 'REMOTE_LIST_PAGE_LIMIT_EXCEEDED');
      }
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      for (const item of result.Contents || []) {
        if (objects.length >= this.maxListedObjects) {
          throw new OffsiteStorageError('Remote listing exceeded its object limit.', 'REMOTE_LIST_LIMIT_EXCEEDED');
        }
        objects.push({ key: item.Key, sizeBytes: Number(item.Size), lastModified: item.LastModified || null });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
    } while (continuationToken);
    return objects;
  }

  async deleteObject(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

module.exports = {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_LISTED_OBJECTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_ATTEMPTS,
  MAX_LISTED_OBJECTS,
  MAX_LIST_PAGES,
  MAX_CONNECTION_TIMEOUT_MS,
  MAX_REQUEST_TIMEOUT_MS,
  OffsiteStorageError,
  S3CompatibleStorage,
  createOffsiteStorageClient,
  resolveOffsiteTransportConfig
};

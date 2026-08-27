const fs = require('fs');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');

class OffsiteStorageError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OffsiteStorageError';
    this.code = code;
  }
}

class S3CompatibleStorage {
  constructor({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle = true, client }) {
    this.bucket = bucket;
    this.client = client || new S3Client({
      endpoint: endpoint || undefined,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey }
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
    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      for (const item of result.Contents || []) {
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

module.exports = { OffsiteStorageError, S3CompatibleStorage };

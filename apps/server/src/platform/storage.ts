import { generateKeyPairSync } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import type { AppConfig } from './config';

const EMULATOR_PROJECT_ID = 'chatup-emulator';
const EMULATOR_CLIENT_EMAIL = 'emulator@chatup-emulator.iam.gserviceaccount.com';

/**
 * The emulator does not validate signatures, but the client library still
 * needs a private key to build signed URLs locally, so we generate an
 * ephemeral one for emulator mode.
 */
function emulatorCredentials(): { client_email: string; private_key: string } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    client_email: EMULATOR_CLIENT_EMAIL,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export class StorageService {
  private readonly client: Storage;
  private readonly bucketName: string;

  constructor(
    private readonly cfg: Pick<AppConfig, 'GCS_BUCKET' | 'GCS_PROJECT_ID' | 'GCS_EMULATOR_URL'>,
  ) {
    this.bucketName = cfg.GCS_BUCKET;
    const emulatorUrl = cfg.GCS_EMULATOR_URL.trim();
    this.client = new Storage(
      emulatorUrl
        ? {
            projectId: cfg.GCS_PROJECT_ID.trim() || EMULATOR_PROJECT_ID,
            apiEndpoint: emulatorUrl,
            credentials: emulatorCredentials(),
          }
        : { projectId: cfg.GCS_PROJECT_ID.trim() || undefined },
    );
  }

  async ensureBucket(): Promise<void> {
    const bucket = this.client.bucket(this.bucketName);
    const [exists] = await bucket.exists();
    if (!exists) {
      await this.client.createBucket(this.bucketName);
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client
      .bucket(this.bucketName)
      .file(key)
      .save(body, { contentType, resumable: false });
  }

  async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
    const [url] = await this.client
      .bucket(this.bucketName)
      .file(key)
      .getSignedUrl({
        action: 'read',
        version: 'v4',
        expires: Date.now() + ttlSeconds * 1000,
      });
    return url;
  }

  async delete(key: string): Promise<void> {
    await this.client.bucket(this.bucketName).file(key).delete({ ignoreNotFound: true });
  }
}

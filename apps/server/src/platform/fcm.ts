import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { FidMulticastMessage } from 'firebase-admin/messaging';
import path from 'node:path';
import fs from 'node:fs';
import type { AppConfig } from './config';
import type { Logger } from './logger';

type FcmConfig = Pick<
  AppConfig,
  'FCM_ENABLED' | 'FCM_PROJECT_ID' | 'FCM_DRY_RUN' | 'FCM_SERVICE_ACCOUNT_PATH' | 'APP_URL'
>;

export interface SendPushInput {
  tokens: string[];
  notification?: {
    title?: string;
    body?: string;
    imageUrl?: string;
  };
  data?: Record<string, string>;
}

export interface SendPushResult {
  attempted: number;
  succeeded: number;
  failed: number;
  invalidTargets: string[];
  /** Why nothing was sent, when applicable. */
  skippedReason?: 'disabled' | 'no-tokens' | 'init-failed' | 'fatal';
}

const APP_NAME = 'chatup-fcm';

const DEAD_REGISTRATION_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function resolveCredential(customPath?: string, logger?: Logger) {
  const jsonFilename = customPath || 'serviceAccountKey.json';
  const resolvedPath = path.isAbsolute(jsonFilename)
    ? jsonFilename
    : path.join(process.cwd(), jsonFilename);

  if (fs.existsSync(resolvedPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      logger?.info(
        { path: resolvedPath, projectId: serviceAccount.project_id },
        'FCM initialized via service account key file',
      );
      return cert(serviceAccount);
    } catch (err) {
      logger?.error({ err, path: resolvedPath }, 'Failed to parse service account key file');
    }
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    logger?.info('FCM initialized via environment variable credentials');
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  logger?.info('FCM initialized via Application Default Credentials (ADC)');
  return applicationDefault();
}

export class FcmService {
  constructor(
    private readonly cfg: FcmConfig,
    private readonly logger: Logger,
  ) {}

  async sendPush(input: SendPushInput): Promise<SendPushResult> {
    const targets = [...new Set((input.tokens ?? []).map((f) => f.trim()).filter(Boolean))];
    const attempted = targets.length;

    if (!this.cfg.FCM_ENABLED) {
      // warn (not debug) so a forgotten FCM_ENABLED=true is obvious in logs
      this.logger.warn('FCM_ENABLED=false: push NOT sent. Set FCM_ENABLED=true in .env');
      return { attempted, succeeded: 0, failed: 0, invalidTargets: [], skippedReason: 'disabled' };
    }

    if (attempted === 0) {
      this.logger.debug('No valid FCM target tokens provided for push dispatch');
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        invalidTargets: [],
        skippedReason: 'no-tokens',
      };
    }

    let messaging: ReturnType<typeof getMessaging>;
    try {
      const existing = getApps().find((a) => a.name === APP_NAME);
      const projectId = this.cfg.FCM_PROJECT_ID?.trim();
      const credential = resolveCredential(this.cfg.FCM_SERVICE_ACCOUNT_PATH, this.logger);

      const app =
        existing ??
        initializeApp(
          {
            credential,
            ...(projectId ? { projectId } : {}),
          },
          APP_NAME,
        );
      messaging = getMessaging(app);
    } catch (err) {
      this.logger.error({ err }, 'FCM initialization failed; push NOT sent');
      return { attempted, succeeded: 0, failed: 0, invalidTargets: [], skippedReason: 'init-failed' };
    }

    if (this.cfg.FCM_DRY_RUN) {
      this.logger.warn('FCM_DRY_RUN=true: messages are validated but NOT delivered to devices');
    }

    const appUrl = this.cfg.APP_URL?.replace(/\/$/, '');

    // Every data value must be a string (FCM rejects anything else).
    // No webpush.fcmOptions.link: FCM requires https for it, which breaks on
    // http://localhost. The service worker opens the right conversation from
    // data.conversationId instead.
    const message = {
      fids: targets,
      ...(input.notification ? { notification: input.notification } : {}),
      ...(input.data
        ? {
            data: Object.fromEntries(
              Object.entries(input.data).map(([k, v]) => [k, String(v)]),
            ),
          }
        : {}),
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        ...(appUrl
          ? { notification: { icon: `${appUrl}/icons/192.png`, badge: `${appUrl}/icons/192.png` } }
          : {}),
        fcmOptions: {
          analyticsLabel: 'chatup_web_push',
        }
      },
    } as FidMulticastMessage;

    try {
      const response = await messaging.sendEachForMulticast(message, this.cfg.FCM_DRY_RUN);

      const invalidTargets: string[] = [];
      response.responses.forEach((res, i) => {
        const target = targets[i]!;
        if (res.success) {
          this.logger.info(
            { messageId: res.messageId, token: `${target.slice(0, 12)}...` },
            'FCM accepted message',
          );
          return;
        }
        const code = res.error?.code;
        this.logger.warn(
          { code, message: res.error?.message, token: `${target.slice(0, 12)}...` },
          'FCM delivery failed for target',
        );
        if (typeof code === 'string' && DEAD_REGISTRATION_CODES.has(code)) {
          invalidTargets.push(target);
        }
      });

      this.logger.info(
        {
          attempted,
          succeeded: response.successCount,
          failed: response.failureCount,
          invalidTargetsCount: invalidTargets.length,
          dryRun: this.cfg.FCM_DRY_RUN,
        },
        'FCM push batch processing complete',
      );

      return {
        attempted,
        succeeded: response.successCount,
        failed: response.failureCount,
        invalidTargets,
      };
    } catch (err) {
      this.logger.error({ err }, 'Fatal error during FCM multicast dispatch');
      return { attempted, succeeded: 0, failed: 0, invalidTargets: [], skippedReason: 'fatal' };
    }
  }
}
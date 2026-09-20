import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { LIMITS, type MediaUploadResult } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import type { Logger } from '../../platform/logger';
import type { StorageService } from '../../platform/storage';

const IMAGE_SIGNATURES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

function detectImageMime(buf: Buffer): string | null {
  for (const sig of IMAGE_SIGNATURES) {
    const off = sig.offset ?? 0;
    if (sig.bytes.every((b, i) => buf[off + i] === b)) return sig.mime;
  }
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    buf.subarray(8, 12).equals(Buffer.from('WEBP'))
  ) {
    return 'image/webp';
  }
  return null;
}

function detectAudioMime(buf: Buffer): string | null {
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    buf.subarray(8, 12).equals(Buffer.from('WEBM'))
  ) {
    return 'audio/webm';
  }
  if (buf.length > 12 && buf.subarray(4, 8).equals(Buffer.from('ftyp'))) {
    return 'audio/mp4';
  }
  if (buf.subarray(0, 4).equals(Buffer.from('OggS'))) {
    return 'audio/ogg';
  }
  if (buf.subarray(0, 3).equals(Buffer.from('ID3')) || buf[0] === 0xff) {
    return 'audio/mpeg';
  }
  return null;
}

export function createMediaModule(deps: {
  db: Db;
  config: AppConfig;
  logger: Logger;
  storage: StorageService;
  requireAuth: RequestHandler;
}): Router {
  const { db, storage, logger } = deps;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.AUDIO_MAX_BYTES, files: 1 },
  });

  router.post(
    '/media/:kind',
    deps.requireAuth,
    upload.single('file'),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const kind = req.params.kind === 'image' ? 'image' : req.params.kind === 'audio' ? 'audio' : null;
      if (!kind) throw Errors.badRequest('Unsupported media kind');

      const file = req.file;
      if (!file) throw Errors.badRequest('A file is required');

      const maxBytes = kind === 'image' ? LIMITS.IMAGE_MAX_BYTES : LIMITS.AUDIO_MAX_BYTES;
      if (file.size > maxBytes) {
        throw Errors.badRequest(`File exceeds the maximum size of ${maxBytes} bytes`);
      }

      const buf = file.buffer;
      const detected = kind === 'image' ? detectImageMime(buf) : detectAudioMime(buf);
      const allowed = kind === 'image' ? LIMITS.IMAGE_ALLOWED_MIME : LIMITS.AUDIO_ALLOWED_MIME;
      if (!detected || !(allowed as readonly string[]).includes(detected)) {
        throw Errors.badRequest(`File content is not a supported ${kind}`);
      }

      const durationMs =
        kind === 'audio' && typeof req.body.durationMs === 'string'
          ? Number.parseInt(req.body.durationMs, 10)
          : null;
      if (kind === 'audio' && (durationMs === null || Number.isNaN(durationMs) || durationMs <= 0 || durationMs > LIMITS.RECORDING_MAX_SECONDS * 1000)) {
        throw Errors.badRequest('Audio messages require a valid durationMs');
      }

      const attachment = await db.mediaAttachment.create({
        data: {
          ownerId: auth.userId,
          kind: kind.toUpperCase() as 'IMAGE' | 'AUDIO',
          mimeType: detected,
          sizeBytes: file.size,
          storageKey: "",
          durationMs: kind === 'audio' ? durationMs : null,
        },
      });

      const storageKey = `attachments/${attachment.id}`;
      await db.mediaAttachment.update({
        where: { id: attachment.id },
        data: { storageKey },
      });

      try {
        await storage.put(storageKey, buf, detected);
      } catch (err) {
        logger.error({ err, attachmentId: attachment.id }, 'Media upload to storage failed');
        await db.mediaAttachment.delete({ where: { id: attachment.id } }).catch(() => {});
        throw Errors.internal();
      }

      const completed = await db.mediaAttachment.update({
        where: { id: attachment.id },
        data: { status: 'COMPLETED' },
      });

      const result: MediaUploadResult = {
        attachment: {
          id: completed.id,
          kind: completed.kind.toLowerCase() as 'image' | 'audio',
          mimeType: completed.mimeType,
          sizeBytes: completed.sizeBytes,
          url: null,
          width: null,
          height: null,
          durationMs: completed.durationMs,
        },
      };
      res.status(201).json(result);
    }),
  );

  router.get('/media/:id', deps.requireAuth, asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (!auth) throw Errors.unauthorized();

    const attachment = await db.mediaAttachment.findUnique({
      where: {
        id: req.params.id as string,
      },
      include: {
        message: {
          include: {
            conversation: {
              include: {
                participants: { select: { userId: true } },
              },
            },
          },
        },
      },
    })

    if (!attachment) throw Errors.notFound('Media attachment not found');
    if (!attachment.message) throw Errors.badRequest('Media attachment is not associated with a message');

    const isParticipant = attachment.message.conversation.participants.some((p) => p.userId === auth.userId);

    if (!isParticipant) throw Errors.forbidden('Not a partcipant in this conversation');

    const url = await storage.signedGetUrl(attachment.storageKey, 300);

    res.json({ url });

  }));

  return router;
}

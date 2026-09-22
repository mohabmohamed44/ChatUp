export const LIMITS = {
  EMAIL_MAX: 254,
  PASSWORD_MIN: 10,
  PASSWORD_MAX: 128,
  DISPLAY_NAME_MIN: 2,
  DISPLAY_NAME_MAX: 50,

  MESSAGE_MAX_LENGTH: 4000,

  SEARCH_QUERY_MIN: 2,
  SEARCH_RESULTS_MAX: 20,

  HISTORY_PAGE_SIZE: 50,
  HISTORY_PAGE_MAX: 100,

  IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  IMAGE_ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as readonly string[],

  AUDIO_MAX_BYTES: 10 * 1024 * 1024,
  AUDIO_ALLOWED_MIME: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'] as readonly string[],
  RECORDING_MAX_SECONDS: 120,

  TYPING_EMIT_THROTTLE_MS: 2000,
  TYPING_INDICATOR_TTL_MS: 6000,

  PRESENCE_GRACE_MS: 30_000,
  PRESENCE_SNAPSHOT_MAX_IDS: 200,

  SESSION_COOKIE_NAME: 'chatup_session',
  CSRF_COOKIE_NAME: 'chatup_csrf',
  CSRF_HEADER_NAME: 'x-csrf-token',

  MEDIA_URL_TTL_SECONDS: 900,
} as const;

export const PREVIEW_LABELS = {
  image: 'Photo',
  audio: 'Voice message',
} as const;

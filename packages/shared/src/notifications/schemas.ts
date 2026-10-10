import { z } from 'zod';

/**
 * Push-notification acknowledgement. The service worker beacons these after
 * it displays a notification ('displayed') and when the user taps it
 * ('clicked'), so the server can confirm device delivery beyond FCM accept.
 */
export const PUSH_ACK_STATUSES = ['displayed', 'clicked'] as const;
export type PushAckStatus = (typeof PUSH_ACK_STATUSES)[number];

export const pushAckSchema = z.object({
  messageId: z.uuid(),
  status: z.enum(PUSH_ACK_STATUSES),
});

export type PushAckInput = z.infer<typeof pushAckSchema>;

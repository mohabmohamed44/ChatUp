import { z } from 'zod';

export const startConversationSchema = z.object({
  userId: z.uuid(),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;

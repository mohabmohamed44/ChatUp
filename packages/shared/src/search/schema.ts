import { z } from "zod";


export const timeFilterValues = [
    'any',
    '24h',
    'week',
    'month',
    '3months',
    'year',
    'older',
    'custom'
] as const;

export type TimeFilter = (typeof timeFilterValues)[number];

export const searchMessageSchema = z.object({
    q: z.string().min(2).max(100),
    conversationId: z.string().uuid().optional(),
    partnerId: z.string().uuid().optional(),
    after: z.coerce.date().optional(),
    before: z.coerce.date().optional(),
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
});


export type searchMessageInput = z.infer<typeof searchMessageSchema>;

export const searchConversationsSchema = z.object({
    q: z.string().min(2).max(100).optional(),
    lastActiveAfter: z.coerce.date().optional(),
    lastActiveBefore: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchConversationsInput = z.infer<typeof searchConversationsSchema>;

export interface SearchResult {
    id: string;
    conversationId: string;
    senderId: string;
    senderName: string;
    body: string;
    snippet: string;
    createdAt: string;
    sequence: string;
}


import { apiFetch } from "@/shared/lib/api";
import type { ConversationSummary } from "@chatup/shared";


export function listConversations(): Promise<{conversations: ConversationSummary[]}> {
    return apiFetch('/conversations');
}

export function startDirectConversation(userId: string): Promise<{conversation: ConversationSummary}> {
    return apiFetch('/conversations/direct', {
        method: 'POST',
        body: {
            userId
        },
    });
}


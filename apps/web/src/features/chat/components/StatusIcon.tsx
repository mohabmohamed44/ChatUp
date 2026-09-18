'use client';

import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import type { ClientMessageStatus } from '@chatup/shared';
import { cn } from '@/shared/lib/utils';

/**
 * Renders the delivery status indicator for an outgoing message.
 *
 * Status meanings (from the backend contract):
 * - pending    → local only, server has not acknowledged yet
 * - sent       → server persisted the message
 * - delivered  → recipient client acknowledged receipt
 * - read       → recipient opened the conversation while visible
 * - failed     → send failed; caller should offer retry
 */
const LABELS: Record<ClientMessageStatus, string> = {
  pending: 'Sending…',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed to send',
};

export function StatusIcon({ status }: { status: ClientMessageStatus }) {
  const label = LABELS[status];
  const icon = (() => {
    switch (status) {
      case 'pending':
        return <Clock className="h-3 w-3 opacity-70" />;
      case 'sent':
        return <Check className="h-3 w-3 opacity-90" />;
      case 'delivered':
        return <CheckCheck className="h-3 w-3 opacity-90" />;
      case 'read':
        return <CheckCheck className="h-3 w-3 text-sky-300" />;
      case 'failed':
        return <AlertCircle className="h-3 w-3 text-red-300" />;
    }
  })();

  return (
    <span title={label} aria-label={label} className="inline-flex items-center">
      {icon}
    </span>
  );
}

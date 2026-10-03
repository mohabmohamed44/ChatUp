'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, SendHorizontal } from 'lucide-react';
import { LIMITS } from '@chatup/shared';
import { ImagePicker } from './ImagePicker';
import type { SendInput } from '../hooks/useSendMessage';
import { VoiceRecorder } from './VoiceRecorder';

export function MessageComposer({
  conversationId,
  onSend,
  onTyping,
  disabled = false,
  editMode = null,
}: {
  conversationId: string;
  onSend: (input: SendInput) => void;
  onTyping?: () => void;
  disabled?: boolean;
  editMode?: {
    body: string;
    onSave: (newBody: string) => Promise<void> | void;
    onCancel: () => void;
  } | null;
}) {
  const [value, setValue] = useState(editMode?.body ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(editMode ? editMode.body : '');
    if (editMode) textareaRef.current?.focus();
    // Only re-run when the edited message's body changes (entering edit mode
    // or switching to another message). Depending on the whole `editMode`
    // object would reset the draft on every parent re-render, since the
    // parent passes a fresh inline object each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode?.body]);

  // Auto-resize the textarea as the user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;

  function submitText() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    if (editMode) {
      void (async () => {
        await editMode.onSave(trimmed);
        setValue('');
      })();
      return;
    }

    onSend({ kind: 'text', body: trimmed });
    setValue('');
    textareaRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitText();
    }
  }

  function handleImageUploaded(attachmentId: string, localPreviewUrl: string) {
    if (disabled) return;
    onSend({ kind: 'image', attachmentId, localPreviewUrl });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitText();
      }}
      className="border-t border-slate-200 bg-white p-3"
    >
      {editMode ? (
        <div className="mb-2 flex items-center justify-between border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-xs">
          <span className="flex items-center gap-2 text-indigo-700">
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Editing message
          </span>
          <button
            type="button"
            onClick={editMode.onCancel}
            className="text-indigo-600 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <ImagePicker
          onUploaded={handleImageUploaded}
          disabled={disabled}
        />
        <label htmlFor="message-composer" className="sr-only">
          Message
        </label>
        <textarea
          ref={textareaRef}
          id="message-composer"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onTyping?.();
          }}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={LIMITS.MESSAGE_MAX_LENGTH}
          disabled={disabled}
          placeholder={disabled ? 'Reconnecting…' : 'Type a message'}
          aria-describedby="message-composer-hint"
          className="max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 disabled:opacity-60"
        />
          <VoiceRecorder
            conversationId={conversationId}
            onRecorded={(attachmentId, durationMs, previewUrl) => {
              if (disabled) return;
              onSend({ kind: 'audio', attachmentId, durationMs });
              // previewUrl is unused for audio today — the real URL replaces it on ack
              void previewUrl;
            }}
            disabled={disabled}
          />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="rounded-full bg-indigo-600 p-2.5 text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
      <p
        id="message-composer-hint"
        className="mt-1.5 hidden text-[11px] text-slate-400 sm:block"
      >
        Enter to send · Shift + Enter for a new line
      </p>
    </form>
  );
}

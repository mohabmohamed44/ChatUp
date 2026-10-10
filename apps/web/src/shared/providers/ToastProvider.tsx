'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Check, AlertCircle, AlertTriangle, Info, X} from "lucide-react";
import { cn } from "@/shared/lib/utils";


export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
    id: string;
    message: string;
    variant: ToastVariant;
    duration: number;
    onClick?: () => void;
}

type ToastContextValue = {
    showToast: (message: string, options?: {
        variant?: ToastVariant;
        duration?: number;
        onClick?: () => void;
    }) => void;
    hideToast: (id: string) => void;
    dismiss: (id: string) => void;
}

const DEFAULT_DURATION = 2500;
const MAX_VISIBLE = 3;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode}) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timers = useRef(new Map<string, number>());

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
        const timer = timers.current.get(id);
        if (timer) {
            window.clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    const showToast = useCallback<ToastContextValue['showToast']>((message, options) => {
        const id = crypto.randomUUID();
        const duration = options?.duration ?? DEFAULT_DURATION;
        const variant = options?.variant ?? 'success';
        const onClick = options?.onClick;

        setToasts((prev) => {
            const next = [...prev, { id, message, variant, duration, onClick }];
            return next.slice(-MAX_VISIBLE);
        });

        const timer = window.setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
    }, [dismiss]);

    // clean up timer when component unmounts
    useEffect(() => {
        const map = timers.current;
        return () => {
            map.forEach((timer) => window.clearTimeout(timer));
            map.clear();
        }
    }, []);

    const value = useMemo<ToastContextValue>(() => ({
        showToast,
        hideToast: dismiss,
        dismiss,
        warningToast: (message: string) => showToast(message, { variant: 'warning' }),
    }), [showToast, dismiss]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    )
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

function ToastContainer({
    toasts,
    onDismiss,
  }: {
    toasts: Toast[];
    onDismiss: (id: string) => void;
  }) {
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    );
  }
  
  function ToastItem({
    toast,
    onDismiss,
  }: {
    toast: Toast;
    onDismiss: (id: string) => void;
  }) {
    const Icon = toast.variant === 'error' ? AlertCircle : toast.variant === 'warning' ? AlertTriangle : toast.variant === 'info' ? Info : Check;

    return (
      <div
        role="status"
        onClick={toast.onClick}
        className={cn(
          'pointer-events-auto relative min-w-[220px] max-w-sm overflow-hidden rounded-lg shadow-lg',
          'animate-[toast-slide-up_200ms_ease-out]',
          toast.variant === 'success' && 'bg-green-600 text-white',
          toast.variant === 'error' && 'bg-red-600 text-white',
          toast.variant === 'info' && 'bg-blue-600 text-white',
          toast.variant === 'warning' && 'bg-yellow-600 text-white',
          toast.onClick && 'cursor-pointer',
        )}
      >
        <div className="flex items-center gap-2 px-4 py-3 pr-10">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
  
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
  
        {/* Progress bar — shrinks from 100% to 0 over the toast duration */}
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5 origin-left bg-white/40"
          style={{ animation: `toast-progress ${toast.duration}ms linear forwards` }}
        />
      </div>
    );
  }
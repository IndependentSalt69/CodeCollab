import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newToast: ToastItem = { id, message, type, duration };

    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 9999,
          maxWidth: '380px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((toast) => {
          const typeConfig = {
            success: {
              icon: <CheckCircle2 size={18} color="var(--success-green)" />,
              borderColor: 'var(--success-green)',
              bgColor: 'rgba(52, 211, 153, 0.1)',
            },
            error: {
              icon: <AlertCircle size={18} color="var(--danger-red)" />,
              borderColor: 'var(--danger-red)',
              bgColor: 'rgba(239, 68, 68, 0.1)',
            },
            warning: {
              icon: <AlertTriangle size={18} color="var(--warning-amber)" />,
              borderColor: 'var(--warning-amber)',
              bgColor: 'rgba(251, 191, 36, 0.1)',
            },
            info: {
              icon: <Info size={18} color="var(--accent-cyan)" />,
              borderColor: 'var(--accent-cyan)',
              bgColor: 'rgba(34, 211, 238, 0.1)',
            },
          }[toast.type];

          return (
            <div
              key={toast.id}
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                backgroundColor: 'var(--bg-elevated)',
                border: `1px solid ${typeConfig.borderColor}`,
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-xl)',
                color: 'var(--text-main)',
                fontSize: '0.875rem',
                lineHeight: 1.4,
                animation: 'slideUp 0.2s ease-out',
              }}
            >
              <div style={{ flexShrink: 0 }}>{typeConfig.icon}</div>
              <div style={{ flex: 1, wordBreak: 'break-word' }}>{toast.message}</div>
              <button
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss notification"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      addToast: () => {},
      removeToast: () => {},
    };
  }
  return context;
};

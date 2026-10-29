import React, { ReactNode } from 'react';

export type BadgeVariant = 'violet' | 'cyan' | 'green' | 'amber' | 'red' | 'neutral';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  icon,
  className = '',
  style,
  'data-testid': testId,
}) => {
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'violet':
        return {
          backgroundColor: 'var(--primary-violet-subtle)',
          color: '#c4b5fd',
          border: '1px solid rgba(139, 92, 246, 0.3)',
        };
      case 'cyan':
        return {
          backgroundColor: 'var(--accent-cyan-subtle)',
          color: 'var(--accent-cyan)',
          border: '1px solid rgba(34, 211, 238, 0.3)',
        };
      case 'green':
        return {
          backgroundColor: 'var(--success-green-subtle)',
          color: 'var(--success-green)',
          border: '1px solid rgba(52, 211, 153, 0.3)',
        };
      case 'amber':
        return {
          backgroundColor: 'var(--warning-amber-subtle)',
          color: 'var(--warning-amber)',
          border: '1px solid rgba(251, 191, 36, 0.3)',
        };
      case 'red':
        return {
          backgroundColor: 'var(--danger-red-subtle)',
          color: 'var(--danger-red)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
        };
      case 'neutral':
      default:
        return {
          backgroundColor: 'var(--bg-elevated)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border-medium)',
        };
    }
  };

  return (
    <span
      data-testid={testId}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: '0.75rem',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        lineHeight: 1.3,
        userSelect: 'none',
        ...getVariantStyles(),
        ...style,
      }}
    >
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      <span>{children}</span>
    </span>
  );
};

export default Badge;

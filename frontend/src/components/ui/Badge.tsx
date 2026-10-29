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
          color: 'var(--primary-violet)',
          border: '1px solid rgba(124, 58, 237, 0.25)',
        };
      case 'cyan':
        return {
          backgroundColor: 'var(--accent-cyan-subtle)',
          color: 'var(--accent-cyan)',
          border: '1px solid rgba(2, 132, 199, 0.25)',
        };
      case 'green':
        return {
          backgroundColor: 'var(--success-green-subtle)',
          color: 'var(--success-green)',
          border: '1px solid rgba(22, 163, 74, 0.25)',
        };
      case 'amber':
        return {
          backgroundColor: 'var(--warning-amber-subtle)',
          color: 'var(--warning-amber)',
          border: '1px solid rgba(217, 119, 6, 0.25)',
        };
      case 'red':
        return {
          backgroundColor: 'var(--danger-red-subtle)',
          color: 'var(--danger-red)',
          border: '1px solid rgba(220, 38, 38, 0.25)',
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

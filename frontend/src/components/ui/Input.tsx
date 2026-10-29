import React, { InputHTMLAttributes, useState, ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  helperText?: string;
  leftIcon?: ReactNode;
  isPassword?: boolean;
}

export const Input: React.FC<InputProps> = ({
  id,
  label,
  error,
  helperText,
  leftIcon,
  isPassword = false,
  type = 'text',
  disabled,
  style,
  className = '',
  ...props
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const resolvedType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-main)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{label}</span>
        </label>
      )}

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {leftIcon && (
          <div
            style={{
              position: 'absolute',
              left: '12px',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              color: 'var(--text-muted)',
            }}
          >
            {leftIcon}
          </div>
        )}

        <input
          id={id}
          type={resolvedType}
          disabled={disabled}
          className={className}
          style={{
            width: '100%',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-main)',
            border: `1px solid ${error ? 'var(--danger-red)' : 'var(--border-medium)'}`,
            borderRadius: 'var(--radius-md)',
            padding: leftIcon ? '9px 40px 9px 38px' : isPassword ? '9px 40px 9px 12px' : '9px 12px',
            fontSize: '0.9rem',
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
            ...style,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = error ? 'var(--danger-red)' : 'var(--primary-violet)';
            e.currentTarget.style.boxShadow = error
              ? '0 0 0 2px rgba(239, 68, 68, 0.2)'
              : '0 0 0 2px rgba(139, 92, 246, 0.2)';
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? 'var(--danger-red)' : 'var(--border-medium)';
            e.currentTarget.style.boxShadow = 'none';
            props.onBlur?.(e);
          }}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((prev) => !prev)}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: '10px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
            }}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>

      {error ? (
        <span style={{ fontSize: '0.8rem', color: 'var(--danger-red)' }}>{error}</span>
      ) : helperText ? (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{helperText}</span>
      ) : null}
    </div>
  );
};

export default Input;

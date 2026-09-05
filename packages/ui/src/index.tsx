import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  children,
  className = '',
  variant = 'secondary',
  type = 'button',
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button className={`yanyi-button yanyi-button--${variant} ${className}`} type={type} {...props}>
      {children}
    </button>
  );
}

export function StatusDot({ tone }: { tone: 'success' | 'info' | 'danger' | 'muted' }) {
  return <span aria-hidden="true" className={`status-dot status-dot--${tone}`} />;
}

import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-lime-400 text-zinc-950 shadow-lg shadow-lime-400/20 hover:bg-lime-300',
  secondary: 'border border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10',
  ghost: 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
  danger: 'text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-sm',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-5 text-base',
};

/** Button styles, also for links that look like buttons: `<Link className={buttonClass('secondary')}>`. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return clsx(
    'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400',
    'disabled:pointer-events-none disabled:opacity-40',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

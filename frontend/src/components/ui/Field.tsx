import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';

interface FieldProps {
  label: string;
  /** Visually hidden label, for controls inside a table row that has column headings. */
  hideLabel?: boolean;
  error?: string | null;
  hint?: string;
  /** Classes for the wrapper, e.g. width or grid placement. */
  className?: string;
}

function controlClass(invalid: boolean, extra?: string) {
  return clsx(
    'h-10 w-full rounded-xl border bg-zinc-950/60 px-3 text-sm text-zinc-100 transition-colors',
    'placeholder:text-zinc-500 focus:ring-2 focus:outline-none',
    invalid
      ? 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-400/20'
      : 'border-white/10 focus:border-lime-400/60 focus:ring-lime-400/20',
    extra,
  );
}

function FieldShell({
  label,
  hideLabel,
  error,
  hint,
  className,
  controlId,
  messageId,
  children,
}: FieldProps & { controlId: string; messageId: string; children: ReactNode }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={controlId}
        className={clsx('text-xs font-medium tracking-wide text-zinc-400 uppercase', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p id={messageId} className="text-xs text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Icon shown inside the input on the left. */
  icon?: ReactNode;
  inputClassName?: string;
}

export function Input({
  label,
  hideLabel,
  error,
  hint,
  className,
  icon,
  inputClassName,
  ...props
}: InputProps) {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  return (
    <FieldShell {...{ label, hideLabel, error, hint, className, controlId, messageId }}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
            {icon}
          </span>
        )}
        <input
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={controlClass(Boolean(error), clsx(icon !== undefined && 'pl-9', inputClassName))}
          {...props}
        />
      </div>
    </FieldShell>
  );
}

interface SelectProps extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {}

export function Select({ label, hideLabel, error, hint, className, children, ...props }: SelectProps) {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  return (
    <FieldShell {...{ label, hideLabel, error, hint, className, controlId, messageId }}>
      <div className="relative">
        <select
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={controlClass(Boolean(error), 'appearance-none pr-9')}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-zinc-500"
        />
      </div>
    </FieldShell>
  );
}

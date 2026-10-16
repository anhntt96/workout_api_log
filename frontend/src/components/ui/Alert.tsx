import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info';

const TONES = {
  error: {
    icon: CircleAlert,
    box: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
    iconColor: 'text-rose-300',
  },
  success: {
    icon: CircleCheck,
    box: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
    iconColor: 'text-emerald-300',
  },
  info: { icon: Info, box: 'border-sky-400/30 bg-sky-500/10 text-sky-100', iconColor: 'text-sky-300' },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { icon: Icon, box, iconColor } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', box, className)}
    >
      <Icon aria-hidden="true" className={clsx('mt-0.5 size-4 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 opacity-80">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 h-fit rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

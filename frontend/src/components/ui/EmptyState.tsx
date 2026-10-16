import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Actions, such as buttons. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-lime-400/10 ring-1 ring-lime-400/20">
        <Icon aria-hidden="true" className="size-7 text-lime-300" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-400">{description}</p>
      {children && <div className="mt-6 flex flex-wrap items-start justify-center gap-3">{children}</div>}
    </div>
  );
}

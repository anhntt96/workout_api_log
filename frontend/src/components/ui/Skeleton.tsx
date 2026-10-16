import { clsx } from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={clsx('rounded-lg bg-white/5 motion-safe:animate-pulse', className)} />
  );
}

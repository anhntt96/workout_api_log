import { clsx } from 'clsx';
import { CalendarDays } from 'lucide-react';
import { useId } from 'react';
import type { PersonalRecord, WeightUnit } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import type { MetricView } from './metrics';

export function RecordCard({
  metric,
  record,
  unit,
}: {
  metric: MetricView;
  record: PersonalRecord | null;
  unit: WeightUnit;
}) {
  const titleId = useId();
  const Icon = metric.icon;
  return (
    <Card role="group" aria-labelledby={titleId} className="relative overflow-hidden p-5">
      <div
        aria-hidden="true"
        className={clsx('pointer-events-none absolute inset-0 bg-linear-to-br to-transparent', metric.glow)}
      />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className={clsx('grid size-10 place-items-center rounded-xl ring-1', metric.badge)}>
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <h3 id={titleId} className="text-sm font-medium text-zinc-300">
            {metric.label}
          </h3>
        </div>
        {record ? (
          <>
            <p className="mt-6 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
              {formatNumber(record.value)}
              <span className="ml-1.5 text-lg font-medium text-zinc-400">{unit}</span>
            </p>
            <p className="mt-2 text-sm text-zinc-400">{metric.describe(record, unit)}</p>
            <p className="mt-5 flex items-center gap-1.5 text-xs text-zinc-500">
              <CalendarDays aria-hidden="true" className="size-3.5" />
              Achieved <time dateTime={record.date}>{formatDate(record.date)}</time>
            </p>
          </>
        ) : (
          <>
            <p className="mt-6 text-4xl font-bold text-zinc-700">—</p>
            <p className="mt-2 text-sm text-zinc-500">No sets logged yet</p>
          </>
        )}
      </div>
    </Card>
  );
}

import { clsx } from 'clsx';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import type { MetricChange, PersonalRecord, WeightUnit } from '../../api/types';
import { useComparison } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  PERIOD_PRESETS,
  type PeriodPreset,
  comparisonPeriods,
  formatDate,
  formatDayRange,
  todayIsoDay,
} from '../../lib/dates';
import { formatSignedPercent, formatSignedWeight, formatWeight } from '../../lib/format';
import { useActiveSession } from '../../session/session';
import { RECORD_METRICS } from './metrics';

/** Records in the current period so far against the whole previous one, e.g. this month vs last month. */
export function ComparisonPanel({ exerciseName }: { exerciseName: string }) {
  const { userId, unit } = useActiveSession();
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const periods = comparisonPeriods(preset, todayIsoDay());
  const comparison = useComparison(userId, {
    exerciseName,
    unit,
    current: periods.current,
    baseline: periods.baseline,
  });

  let body;
  if (comparison.isPending) {
    body = <Skeleton className="h-40 rounded-xl" />;
  } else if (comparison.isError) {
    body = <ApiErrorAlert error={comparison.error} />;
  } else if (comparison.data.message) {
    body = (
      <p className="rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-zinc-400">
        {comparison.data.message}
      </p>
    );
  } else {
    const { current, baseline, change } = comparison.data.data;
    body = (
      <div
        className={clsx(
          '-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6',
          comparison.isPlaceholderData && 'opacity-60',
        )}
      >
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
              <th scope="col" className="pb-3 font-medium">
                Record
              </th>
              <PeriodHeading label={periods.baselineLabel} from={baseline.from} to={baseline.to} />
              <PeriodHeading label={periods.currentLabel} from={current.from} to={current.to} />
              <th scope="col" className="pb-3 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {RECORD_METRICS.map((metric) => (
              <tr key={metric.key}>
                <th scope="row" className="py-3.5 pr-4 text-left font-medium text-zinc-200">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={clsx('size-2 rounded-full', metric.dot)} />
                    {metric.label}
                  </span>
                </th>
                <RecordCell record={baseline.records[metric.key]} unit={unit} />
                <RecordCell record={current.records[metric.key]} unit={unit} />
                <td className="py-3.5 text-right">
                  <ChangeBadge change={change[metric.key]} unit={unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card className="mt-8 p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Compare periods</h2>
          <p className="text-sm text-zinc-400">
            {periods.currentLabel} so far against all of {periods.baselineLabel.toLowerCase()}.
          </p>
        </div>
        <SegmentedControl
          label="Comparison period"
          options={PERIOD_PRESETS}
          value={preset}
          onChange={setPreset}
        />
      </div>
      {body}
    </Card>
  );
}

function PeriodHeading({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <th scope="col" className="pr-4 pb-3 font-medium">
      {label}
      <span className="block font-normal tracking-normal text-zinc-600 normal-case">
        {formatDayRange(from, to)}
      </span>
    </th>
  );
}

function RecordCell({ record, unit }: { record: PersonalRecord | null; unit: WeightUnit }) {
  if (record === null) return <td className="py-3.5 pr-4 text-zinc-600">—</td>;
  return (
    <td className="py-3.5 pr-4">
      <span className="font-semibold text-zinc-100 tabular-nums">{formatWeight(record.value, unit)}</span>
      <span className="block text-xs text-zinc-500">{formatDate(record.date)}</span>
    </td>
  );
}

const CHANGE_TONES = {
  up: { icon: TrendingUp, className: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20' },
  down: { icon: TrendingDown, className: 'bg-rose-400/10 text-rose-300 ring-rose-400/20' },
  flat: { icon: Minus, className: 'bg-white/5 text-zinc-400 ring-white/10' },
} as const;

function ChangeBadge({ change, unit }: { change: MetricChange | null; unit: WeightUnit }) {
  if (change === null) {
    return (
      <span className="text-zinc-600" title="Needs a record in both periods">
        —
      </span>
    );
  }
  const tone = change.absolute > 0 ? 'up' : change.absolute < 0 ? 'down' : 'flat';
  const { icon: Icon, className } = CHANGE_TONES[tone];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums ring-1',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {formatSignedWeight(change.absolute, unit)}
      {change.percent !== null && ` · ${formatSignedPercent(change.percent)}`}
    </span>
  );
}

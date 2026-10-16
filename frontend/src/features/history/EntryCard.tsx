import type { WorkoutEntry } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { formatSet, formatWeight } from '../../lib/format';
import { entryStats } from './history-view';

export function EntryCard({ entry, muscleGroups }: { entry: WorkoutEntry; muscleGroups: readonly string[] }) {
  const stats = entryStats(entry.sets);
  // History is requested in one display unit, so every set shares it.
  const unit = entry.sets[0]?.unit ?? 'kg';
  return (
    <Card className="p-4 transition-colors hover:border-white/20 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-50">{entry.exerciseName}</h3>
          {muscleGroups.length > 0 && (
            <ul aria-label="Muscle groups" className="mt-1.5 flex flex-wrap gap-1.5">
              {muscleGroups.map((group) => (
                <li
                  key={group}
                  className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-zinc-400 capitalize"
                >
                  {group}
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="flex gap-6 text-right">
          <Stat label="Sets" value={String(stats.setCount)} />
          <Stat label="Volume" value={formatWeight(stats.volume, unit)} />
          <Stat label="Top set" value={stats.topWeight === 0 ? 'BW' : formatWeight(stats.topWeight, unit)} />
        </dl>
      </div>
      <ol aria-label="Sets" className="mt-4 flex flex-wrap gap-2">
        {entry.sets.map((set, index) => (
          // Sets have no id; their position is their identity (set 1, set 2, ...).
          <li
            key={index}
            className="rounded-lg bg-zinc-800/70 px-2.5 py-1 text-sm text-zinc-200 tabular-nums ring-1 ring-white/5"
          >
            <span className="mr-1.5 text-xs text-zinc-500">{index + 1}</span>
            {formatSet(set)}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="text-sm font-semibold text-zinc-100 tabular-nums">{value}</dd>
    </div>
  );
}

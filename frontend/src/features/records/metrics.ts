import { Layers, type LucideIcon, Weight, Zap } from 'lucide-react';
import type { PersonalRecord, RecordMetric, WeightUnit } from '../../api/types';
import { formatReps, formatWeight } from '../../lib/format';

export interface MetricView {
  key: RecordMetric;
  label: string;
  icon: LucideIcon;
  /** Complete class strings (Tailwind only generates classes it finds written out in full). */
  glow: string;
  badge: string;
  dot: string;
  /** How the record was set, e.g. "1 rep × 120 kg". */
  describe: (record: PersonalRecord, unit: WeightUnit) => string;
}

const setOf = (record: PersonalRecord, unit: WeightUnit) =>
  record.weight === 0
    ? `${formatReps(record.reps)} at bodyweight`
    : `${formatReps(record.reps)} × ${formatWeight(record.weight, unit)}`;

export const RECORD_METRICS: readonly MetricView[] = [
  {
    key: 'maxWeight',
    label: 'Heaviest single set',
    icon: Weight,
    glow: 'from-amber-400/15',
    badge: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
    dot: 'bg-amber-300',
    describe: setOf,
  },
  {
    key: 'maxVolume',
    label: 'Highest volume set',
    icon: Layers,
    glow: 'from-sky-400/15',
    badge: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
    dot: 'bg-sky-300',
    describe: setOf,
  },
  {
    key: 'bestE1rm',
    label: 'Best estimated 1RM',
    icon: Zap,
    glow: 'from-violet-400/15',
    badge: 'bg-violet-400/10 text-violet-300 ring-violet-400/25',
    dot: 'bg-violet-300',
    describe: (record, unit) => `Epley, from ${setOf(record, unit)}`,
  },
];

import { Loader2, Sparkles } from 'lucide-react';
import { useLogWorkouts } from '../../api/queries';
import { Button, type ButtonSize, type ButtonVariant } from '../../components/ui/Button';
import { todayIsoDay } from '../../lib/dates';
import { useActiveSession } from '../../session/session';
import { SAMPLE_EXERCISES, buildSampleWorkouts, sampleDataKey } from './sample-workouts';

const SAMPLE_LIST = new Intl.ListFormat('en-US', { type: 'conjunction' }).format(SAMPLE_EXERCISES);

/** Logs eight weeks of sample workouts for the current client in one request. */
export function LoadSampleDataButton({
  variant = 'secondary',
  size = 'md',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { userId } = useActiveSession();
  const logWorkouts = useLogWorkouts(userId);
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant={variant}
        size={size}
        disabled={logWorkouts.isPending}
        onClick={() =>
          logWorkouts.mutate({
            entries: buildSampleWorkouts(todayIsoDay()),
            idempotencyKey: sampleDataKey(userId),
          })
        }
      >
        {logWorkouts.isPending ? (
          <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        ) : (
          <Sparkles aria-hidden="true" className="size-4" />
        )}
        Load sample data
      </Button>
      {/* Says what happened: the sample covers six exercises, and a second load replays the first. */}
      {logWorkouts.isSuccess && (
        <p role="status" className="max-w-xs text-center text-xs text-zinc-400">
          {logWorkouts.data.replayed
            ? `Sample data was already loaded for this client: ${SAMPLE_LIST}.`
            : `Loaded ${logWorkouts.data.entries.length} sample entries for ${SAMPLE_LIST}.`}
        </p>
      )}
      {logWorkouts.isError && (
        <p role="alert" className="text-xs text-rose-300">
          {logWorkouts.error.message}
        </p>
      )}
    </div>
  );
}

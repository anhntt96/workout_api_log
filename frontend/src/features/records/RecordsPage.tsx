import { Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useExercises, usePersonalRecords } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Alert } from '../../components/ui/Alert';
import { buttonClass } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Skeleton } from '../../components/ui/Skeleton';
import { useActiveSession } from '../../session/session';
import { LoadSampleDataButton } from '../sample-data/LoadSampleDataButton';
import { ComparisonPanel } from './ComparisonPanel';
import { RECORD_METRICS } from './metrics';
import { RecordCard } from './RecordCard';

export function RecordsPage() {
  const { userId, unit } = useActiveSession();
  const [params, setParams] = useSearchParams();
  const exercises = useExercises();
  // The exercise is kept in the URL (?exercise=Deadlift); the first catalog exercise is the default.
  const exerciseName = params.get('exercise') ?? exercises.data?.[0]?.name ?? '';
  const records = usePersonalRecords(userId, exerciseName, unit);

  return (
    <>
      <PageHeader
        title="Personal records"
        description="All-time bests for one exercise, with the day each was set."
        actions={
          <Select
            label="Exercise"
            className="w-full sm:w-64"
            value={exerciseName}
            onChange={(event) => setParams({ exercise: event.target.value }, { replace: true })}
            disabled={!exercises.data}
          >
            {exercises.data?.map((exercise) => (
              <option key={exercise.name} value={exercise.name}>
                {exercise.name}
              </option>
            ))}
          </Select>
        }
      />
      {exercises.isError && <ApiErrorAlert error={exercises.error} className="mb-6" />}
      {records.isError && <ApiErrorAlert error={records.error} className="mb-6" />}
      {records.data?.message && (
        <Alert tone="info" title={records.data.message} className="mb-6">
          <p>Log a workout or load sample data to see records here.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/log" className={buttonClass('secondary', 'sm')}>
              <Plus aria-hidden="true" className="size-4" />
              Log workout
            </Link>
            <LoadSampleDataButton size="sm" />
          </div>
        </Alert>
      )}
      {!records.isError && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {RECORD_METRICS.map((metric) =>
              records.data ? (
                <RecordCard
                  key={metric.key}
                  metric={metric}
                  record={records.data.data.records[metric.key]}
                  unit={unit}
                />
              ) : (
                <Skeleton key={metric.key} className="h-52 rounded-2xl" />
              ),
            )}
          </div>
          {exerciseName !== '' && <ComparisonPanel exerciseName={exerciseName} />}
        </>
      )}
    </>
  );
}

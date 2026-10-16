import { ArrowRight, Dumbbell, History, Scale, Sparkles, Trophy } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Field';
import { isUuid } from '../../lib/uuid';
import { useSession } from '../../session/session';

const FEATURES = [
  { icon: History, text: 'History filtered by exercise, muscle group and date' },
  { icon: Trophy, text: 'Heaviest set, best volume set and estimated 1RM' },
  { icon: Scale, text: 'Log and read every weight in kg or lb' },
];

export function WelcomePage() {
  const { userId, setUserId } = useSession();
  const navigate = useNavigate();
  const [value, setValue] = useState(userId ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isUuid(value)) {
      setError('Enter a UUID such as 0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e');
      return;
    }
    setUserId(value);
    navigate('/history');
  }

  function update(next: string) {
    setValue(next);
    setError(null);
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_1fr] lg:px-10">
      <section>
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
          <Dumbbell aria-hidden="true" className="size-3.5 text-lime-300" />
          Workout Log
        </p>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          Every rep logged.
          <span className="block bg-linear-to-r from-lime-300 to-emerald-400 bg-clip-text text-transparent">
            Every record earned.
          </span>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-zinc-400">
          Open a client&apos;s training history and personal records with their user ID.
        </p>
        <ul className="mt-8 space-y-3">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-zinc-300">
              <span className="grid size-8 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
                <Icon aria-hidden="true" className="size-4 text-lime-300" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </section>

      <Card className="p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Choose a client</h2>
        <p className="mt-1 text-sm text-zinc-400">
          The ID is saved in this browser, so next time you go straight to their history.
        </p>
        <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            label="Client user ID"
            value={value}
            onChange={(event) => update(event.target.value)}
            placeholder="0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e"
            autoComplete="off"
            spellCheck={false}
            inputClassName="font-mono"
            error={error}
          />
          <Button type="submit" size="lg" className="w-full">
            Continue
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => update(crypto.randomUUID())}>
            <Sparkles aria-hidden="true" className="size-4" />
            Generate a new client ID
          </Button>
        </form>
      </Card>
    </main>
  );
}

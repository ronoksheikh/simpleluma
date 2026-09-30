import { Button, Chip, FieldError, Input, Label, TextField } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CheckIcon, TrashIcon } from '../components/icons';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ModelForm } from '../components/ModelForm';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { notify } from '../lib/notify';

function Section({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-7 shadow-[0_2px_12px_-4px_rgb(7_23_56/0.1)]">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-night/60">{text}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

// Models -----------------------------------------------------------------------------------------

interface Profile {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  active: boolean;
  keyHint: string;
}

function ModelsSection() {
  const client = useQueryClient();
  const { data: profiles = [] } = useQuery({ queryKey: ['models'], queryFn: () => api.get<Profile[]>('/api/models') });
  const [adding, setAdding] = useState(false);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['models'] });
    await client.invalidateQueries({ queryKey: ['me'] });
  };
  const activate = useMutation({ mutationFn: (id: string) => api.post(`/api/models/${id}/activate`), onSuccess: refresh, onError: (e) => notify.error(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/models/${id}`), onSuccess: refresh, onError: (e) => notify.error(e.message) });

  return (
    <Section title="Models" text="The agent uses the active model. Keys are stored encrypted and are never shown again.">
      {profiles.length > 0 && (
        <ul className="mb-5 divide-y divide-night/10 rounded-2xl border border-night/10">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.model}</div>
                <div className="truncate text-sm text-night/55">{new URL(p.baseUrl).host} · key {p.keyHint}</div>
              </div>
              {p.active ? (
                <Chip color="accent" variant="soft"><Chip.Label>Active</Chip.Label></Chip>
              ) : (
                <Button size="sm" variant="secondary" onPress={() => activate.mutate(p.id)}>Use this model</Button>
              )}
              <Button size="sm" isIconOnly variant="ghost" aria-label={`Remove ${p.model}`} onPress={() => remove.mutate(p.id)}><TrashIcon size={16} /></Button>
            </li>
          ))}
        </ul>
      )}
      {adding || profiles.length === 0 ? (
        <div className="max-w-xl">
          <ModelForm onSaved={() => { setAdding(false); void refresh(); }} />
        </div>
      ) : (
        <Button variant="secondary" onPress={() => setAdding(true)}>Add another model</Button>
      )}
    </Section>
  );
}

// ElevenLabs -------------------------------------------------------------------------------------

interface Settings {
  elevenLabs: { configured: boolean; keyHint: string | null };
  secrets: Array<{ id: string; name: string; createdAt: number }>;
}

interface KeyCheck {
  voices: Array<{ id: string; name: string; category: string }>;
  quota: { used: number; limit: number; remaining: number; resetsAt: number | null } | null;
}

function ElevenLabsSection({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<{ key: string; check: KeyCheck } | null>(null);
  const [error, setError] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['settings'] });

  const test = useMutation({
    mutationFn: () => api.post<KeyCheck>('/api/settings/elevenlabs/test', { apiKey }),
    onMutate: () => setError(''),
    onSuccess: (check) => setResult({ key: apiKey, check }),
    onError: (e) => {
      setResult(null);
      setError(e.message);
    },
  });
  const save = useMutation({
    mutationFn: () => api.put('/api/settings/elevenlabs', { apiKey }),
    onSuccess: async () => {
      setApiKey('');
      setResult(null);
      await refresh();
      notify.success('ElevenLabs key saved');
    },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({ mutationFn: () => api.del('/api/settings/elevenlabs'), onSuccess: refresh });

  const passed = result !== null && result.key === apiKey && apiKey.trim() !== '';
  const check = result?.check;

  return (
    <Section title="Voice-over (ElevenLabs)" text="Add an ElevenLabs key and the agent can write voice-overs. Words are timed, so animations and captions line up with what is said.">
      {settings.elevenLabs.configured && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-night/10 px-4 py-3">
          <CheckIcon className="text-lumablue" />
          <span className="flex-1 text-sm">A key ending {settings.elevenLabs.keyHint} is saved.</span>
          <Button size="sm" variant="ghost" onPress={() => remove.mutate()}>Remove key</Button>
        </div>
      )}
      <div className="max-w-xl">
        <TextField fullWidth type="password" value={apiKey} onChange={(v) => { setApiKey(v); setError(''); }}>
          <Label>{settings.elevenLabs.configured ? 'Replace the key' : 'API key'}</Label>
          <Input placeholder="Paste your ElevenLabs API key" autoComplete="off" />
        </TextField>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" isPending={test.isPending} isDisabled={!apiKey.trim() && !settings.elevenLabs.configured} onPress={() => test.mutate()}>Test</Button>
          <Button isPending={save.isPending} isDisabled={!passed} onPress={() => save.mutate()}>Save</Button>
        </div>
        {!passed && apiKey.trim() !== '' && !error && <p className="mt-2 text-sm text-night/55">Run Test first: Save unlocks when the key passes.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {check && (
          <div className="mt-5 rounded-2xl bg-lumablue/5 p-4">
            <p className="flex items-center gap-2 font-medium"><CheckIcon size={16} className="text-lumablue" />Key works · {check.voices.length} voices</p>
            {check.quota ? (
              <p className="mt-1 text-sm text-night/70">
                {check.quota.remaining.toLocaleString()} of {check.quota.limit.toLocaleString()} characters left
                {check.quota.resetsAt ? ` · resets ${new Date(check.quota.resetsAt).toLocaleDateString()}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-night/70">Remaining quota is not visible to this key.</p>
            )}
            <ul className="thin-scroll mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto">
              {check.voices.map((v) => <li key={v.id}><Chip variant="secondary"><Chip.Label>{v.name}</Chip.Label></Chip></li>)}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

// Secrets ----------------------------------------------------------------------------------------

function SecretsSection({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['settings'] });
  const add = useMutation({
    mutationFn: () => api.put('/api/secrets', { name, value }),
    onSuccess: async () => {
      setName('');
      setValue('');
      await refresh();
    },
    onError: (e) => notify.error(e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/secrets/${id}`), onSuccess: refresh });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Section title="Secrets" text="Named API keys for custom APIs. They become environment variables in the terminal. The agent only sees the names; any value that shows up in output is replaced with [secret:NAME].">
      {settings.secrets.length > 0 && (
        <ul className="mb-5 divide-y divide-night/10 rounded-2xl border border-night/10">
          {settings.secrets.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <code className="flex-1 font-mono text-sm">{s.name}</code>
              <span className="text-sm text-night/50">added {timeAgo(s.createdAt)}</span>
              <Button size="sm" isIconOnly variant="ghost" aria-label={`Delete ${s.name}`} onPress={() => setRemoving(s)}><TrashIcon size={16} /></Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid max-w-xl gap-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <TextField fullWidth value={name} onChange={(v) => setName(v.toUpperCase())}>
          <Label>Name</Label>
          <Input placeholder="MY_API_KEY" autoComplete="off" />
          <FieldError />
        </TextField>
        <TextField fullWidth type="password" value={value} onChange={setValue}>
          <Label>Value</Label>
          <Input placeholder="Secret value" autoComplete="off" />
        </TextField>
        <Button type="submit" variant="secondary" isPending={add.isPending} isDisabled={!name || !value}>Save secret</Button>
      </form>
      <ConfirmDialog
        isOpen={removing !== null}
        title="Delete this secret?"
        message={`${removing?.name ?? ''} will no longer be available in terminals.`}
        confirmLabel="Delete secret"
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </Section>
  );
}

export function SettingsPage() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 pb-16 pt-4">
      <h1 className="wordmark text-3xl">Settings</h1>
      <ModelsSection />
      {settings && <ElevenLabsSection settings={settings} />}
      {settings && <SecretsSection settings={settings} />}
    </div>
  );
}

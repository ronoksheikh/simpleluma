import { Avatar, Button, Chip, FieldError, Input, Label, NumberField, Spinner, Switch, Table, Tabs, TextArea, TextField } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckIcon, RestoreIcon, TrashIcon } from '../components/icons';
import { MemoryList } from '../components/studio/MemoryTab';
import { useMe } from '../lib/auth';
import { tokens } from '../lib/format';
import type { DirectorSettings, Preferences } from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ModelForm } from '../components/ModelForm';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { notify } from '../lib/notify';

function Section({ title, text, children, action }: { title: string; text: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink/55">{text}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
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
    <Section title="Models" text="The Director uses the active model. Keys are stored encrypted and are never shown again.">
      {profiles.length > 0 && (
        <ul className="mb-5 divide-y divide-ink/10 rounded-2xl border border-ink/10">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.model}</div>
                <div className="truncate text-sm text-ink/55">{new URL(p.baseUrl).host} · key {p.keyHint}</div>
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
    <Section title="Voice-over (ElevenLabs)" text="Add an ElevenLabs key and the Director can write voice-overs. Words are timed, so animations and captions line up with what is said.">
      {settings.elevenLabs.configured && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-ink/10 px-4 py-3">
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
        {!passed && apiKey.trim() !== '' && !error && <p className="mt-2 text-sm text-ink/55">Run Test first: Save unlocks when the key passes.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {check && (
          <div className="mt-5 rounded-2xl bg-lumablue/5 p-4">
            <p className="flex items-center gap-2 font-medium"><CheckIcon size={16} className="text-lumablue" />Key works · {check.voices.length} voices</p>
            {check.quota ? (
              <p className="mt-1 text-sm text-ink/70">
                {check.quota.remaining.toLocaleString()} of {check.quota.limit.toLocaleString()} characters left
                {check.quota.resetsAt ? ` · resets ${new Date(check.quota.resetsAt).toLocaleDateString()}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink/70">Remaining quota is not visible to this key.</p>
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
    <Section title="Secrets" text="Named API keys for custom APIs. They become environment variables in the terminal. The Director only sees the names; any value that shows up in output is replaced with [secret:NAME].">
      {settings.secrets.length > 0 && (
        <ul className="mb-5 divide-y divide-ink/10 rounded-2xl border border-ink/10">
          {settings.secrets.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <code className="flex-1 font-mono text-sm">{s.name}</code>
              <span className="text-sm text-ink/50">added {timeAgo(s.createdAt)}</span>
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

// Director ---------------------------------------------------------------------------------------

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <p className="text-[14px] font-medium">{label}</p>
        <p className="text-[12.5px] text-ink/55">{hint}</p>
      </div>
      <Switch isSelected={value} onChange={onChange} aria-label={label}>
        <Switch.Control><Switch.Thumb /></Switch.Control>
      </Switch>
    </div>
  );
}

function DirectorSection() {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ['director'], queryFn: () => api.get<DirectorSettings>('/api/director') });
  const [prompt, setPrompt] = useState<string | null>(null);
  const [showDefault, setShowDefault] = useState(false);
  const save = useMutation({
    mutationFn: (body: { prompt?: string | null; preferences?: Partial<Preferences> }) => api.put<DirectorSettings>('/api/director', body),
    onSuccess: (fresh, body) => {
      client.setQueryData(['director'], fresh);
      if (body.prompt !== undefined) {
        setPrompt(null);
        notify.success('Director prompt saved. It applies from the next step.');
      }
    },
    onError: (e) => notify.error(e.message),
  });
  if (!data) return <Section title="Director" text="Loading…"><Spinner /></Section>;
  const value = prompt ?? data.prompt;
  const p = data.preferences;

  return (
    <>
      <Section
        title="Director prompt"
        text="Who the Director is and how it works: its taste, process and tone. The framework guide, tools, brand.json, memory and the plan are always added after it, so editing this cannot break video building."
        action={data.custom ? <Chip size="sm" color="accent" variant="soft"><Chip.Label>Custom</Chip.Label></Chip> : <Chip size="sm" variant="soft"><Chip.Label>Default</Chip.Label></Chip>}
      >
        <TextArea aria-label="Director system prompt" value={value} onChange={(e) => setPrompt(e.target.value)} rows={16} className="w-full font-mono text-[12.5px] leading-relaxed" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button isDisabled={prompt === null || prompt === data.prompt} isPending={save.isPending} onPress={() => save.mutate({ prompt: value })}>Save prompt</Button>
          {prompt !== null && prompt !== data.prompt && <Button variant="ghost" onPress={() => setPrompt(null)}>Discard changes</Button>}
          <span className="flex-1" />
          {data.custom && <Button variant="ghost" onPress={() => save.mutate({ prompt: null })}><RestoreIcon size={15} />Reset to default</Button>}
          <Button variant="ghost" onPress={() => setShowDefault((v) => !v)}>{showDefault ? 'Hide' : 'Show'} the default</Button>
        </div>
        {showDefault && <pre className="thin-scroll mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-ink/[0.03] p-4 font-mono text-[12px] text-ink/70">{data.defaultPrompt}</pre>}
      </Section>

      <Section title="Long jobs" text="How far the Director goes on its own, and how it keeps its place.">
        <div className="divide-y divide-ink/[0.06]">
          <div className="flex items-start justify-between gap-6 py-3">
            <div>
              <p className="text-[14px] font-medium">Step limit per run</p>
              <p className="text-[12.5px] text-ink/55">After this many model turns the Director pauses and a Continue button appears. Runs keep going when you close the browser.</p>
            </div>
            <NumberField aria-label="Step limit" value={p.stepLimit} minValue={5} maxValue={500} step={5} onChange={(v) => Number.isFinite(v) && save.mutate({ preferences: { stepLimit: v } })} className="w-40">
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          <div className="flex items-start justify-between gap-6 py-3">
            <div>
              <p className="text-[14px] font-medium">Automatic checkpoint every</p>
              <p className="text-[12.5px] text-ink/55">Steps between automatic checkpoints (0 = only when the Director decides). Checkpoints commit the work and survive trimmed context and restarts.</p>
            </div>
            <NumberField aria-label="Checkpoint interval" value={p.checkpointEvery} minValue={0} maxValue={200} onChange={(v) => Number.isFinite(v) && save.mutate({ preferences: { checkpointEvery: v } })} className="w-40">
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          <Toggle label="Check the video after code changes" hint="Loads the video and draws sample frames after each step that changes scenes. Errors go straight back to the Director to fix." value={p.autoCheck} onChange={(v) => save.mutate({ preferences: { autoCheck: v } })} />
          <Toggle label="Auto-detect brand from uploads" hint="Off (recommended): the Director reads your logos, guidelines and kits and writes brand.json with judgement. On: colours, logos and rules are filled in by rules the moment files are uploaded." value={p.autoBrand} onChange={(v) => save.mutate({ preferences: { autoBrand: v } })} />
          <Toggle label="Show thinking" hint="Show the reasoning that reasoning models stream, in a collapsible block above each reply." value={p.showThinking} onChange={(v) => save.mutate({ preferences: { showThinking: v } })} />
        </div>
      </Section>

      <Section title="Memory" text="Notes the Director reads in every conversation, in every project. It adds its own as it learns your taste; project-only notes live in each video's Memory tab.">
        <MemoryList projectId={null} />
      </Section>
    </>
  );
}

// Usage --------------------------------------------------------------------------------------------

interface UsageData {
  total: { prompt: number; completion: number; runs: number; steps: number };
  projects: Array<{ projectId: string; name: string; prompt: number; completion: number; runs: number; steps: number; last: number | null }>;
}

function UsageSection() {
  const { data } = useQuery({ queryKey: ['usage'], queryFn: () => api.get<UsageData>('/api/usage') });
  if (!data) return <Spinner />;
  const max = Math.max(1, ...data.projects.map((p) => p.prompt + p.completion));
  return (
    <Section title="Usage" text="Tokens the Director used, as reported by your provider (estimated when it does not report usage).">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Input tokens', tokens(data.total.prompt)],
          ['Output tokens', tokens(data.total.completion)],
          ['Runs', String(data.total.runs)],
          ['Steps', String(data.total.steps)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-ink/[0.03] px-4 py-3">
            <div className="text-[20px] font-semibold tabular-nums">{value}</div>
            <div className="text-[12px] text-ink/50">{label}</div>
          </div>
        ))}
      </div>
      <Table className="mt-5" aria-label="Usage by video">
        <Table.ScrollContainer>
          <Table.Content aria-label="Usage by video">
            <Table.Header>
              <Table.Column isRowHeader>Video</Table.Column>
              <Table.Column>Tokens</Table.Column>
              <Table.Column>Runs</Table.Column>
              <Table.Column>Last run</Table.Column>
            </Table.Header>
            <Table.Body>
              {data.projects.map((p) => (
                <Table.Row key={p.projectId}>
                  <Table.Cell><Link className="font-medium hover:text-lumablue" to={`/p/${p.projectId}`}>{p.name}</Link></Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/[0.06]"><span className="block h-full rounded-full bg-lumablue" style={{ width: `${((p.prompt + p.completion) / max) * 100}%` }} /></span>
                      <span className="tabular-nums">{tokens(p.prompt + p.completion)}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>{p.runs}</Table.Cell>
                  <Table.Cell>{p.last ? timeAgo(p.last) : '—'}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Section>
  );
}

function AccountSection() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const client = useQueryClient();
  return (
    <Section title="Account" text="You are signed in to this Luma Studio server.">
      <div className="flex items-center gap-3">
        <Avatar color="accent"><Avatar.Fallback>{me?.email.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()}</Avatar.Fallback></Avatar>
        <div className="flex-1">
          <p className="font-medium">{me?.email}</p>
          <p className="text-[12.5px] text-ink/50">Keys and secrets are encrypted on this server.</p>
        </div>
        <Button variant="secondary" onPress={async () => { await api.post('/api/auth/logout'); client.clear(); navigate('/login'); }}>Log out</Button>
      </div>
    </Section>
  );
}

const TABS = [
  { id: 'director', label: 'Director' },
  { id: 'models', label: 'Models' },
  { id: 'voice', label: 'Voice' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'usage', label: 'Usage' },
  { id: 'account', label: 'Account' },
] as const;

export function SettingsPage() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'director';
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 pb-16 pt-10">
      <div>
        <h1 className="wordmark text-[30px]">Settings</h1>
        <p className="mt-1 text-[14px] text-ink/55">Shape the Director, connect models and keys, and see what you have used.</p>
      </div>
      <Tabs selectedKey={tab} onSelectionChange={(k) => setParams({ tab: String(k) }, { replace: true })}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Settings sections">
            {TABS.map((t) => <Tabs.Tab key={t.id} id={t.id}>{t.label}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      {tab === 'director' && <DirectorSection />}
      {tab === 'models' && <ModelsSection />}
      {tab === 'voice' && settings && <ElevenLabsSection settings={settings} />}
      {tab === 'secrets' && settings && <SecretsSection settings={settings} />}
      {tab === 'usage' && <UsageSection />}
      {tab === 'account' && <AccountSection />}
    </div>
  );
}

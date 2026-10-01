import { Alert, Button, ComboBox, FieldError, Input, Label, ListBox, Spinner, TextField } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface ModelInfo {
  id: string;
  name: string;
  tools?: boolean;
}

const PRESETS = [
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', prefer: ['anthropic/claude-sonnet', 'openai/gpt-5', 'openai/gpt-4.1'] },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', prefer: ['gpt-5', 'gpt-4.1', 'gpt-4o'] },
  { id: 'custom', label: 'Custom', baseUrl: '', prefer: [] as string[] },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

/** Pick a provider, paste a key: the model list loads by itself. "Test & save" proves the model can call tools. */
export function ModelForm({ onSaved }: { onSaved: () => void }) {
  const client = useQueryClient();
  const [preset, setPreset] = useState<PresetId>('openrouter');
  const [baseUrl, setBaseUrl] = useState<string>(PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const choose = (id: PresetId) => {
    setPreset(id);
    setBaseUrl(PRESETS.find((p) => p.id === id)!.baseUrl);
    setModels([]);
    setModel('');
  };

  // Load the model list as soon as a key is in.
  useEffect(() => {
    setListError('');
    if (apiKey.trim().length < 8 || !/^https?:\/\/.+/.test(baseUrl.trim())) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { models: list } = await api.post<{ models: ModelInfo[] }>('/api/models/available', { baseUrl, apiKey });
        setModels(list);
        const prefer = PRESETS.find((p) => p.id === preset)!.prefer;
        setModel((current) => current || prefer.map((p) => list.find((m) => m.id.startsWith(p))?.id).find(Boolean) || '');
      } catch (e) {
        setModels([]);
        setListError(e instanceof ApiError ? e.message : 'Could not load models.');
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [apiKey, baseUrl, preset]);

  const selected = models.find((m) => m.id === model);

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await api.post('/api/models', { baseUrl, apiKey, model });
      await client.invalidateQueries({ queryKey: ['me'] });
      await client.invalidateQueries({ queryKey: ['models'] });
      onSaved();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save the model.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <span className="block text-sm font-medium">Provider</span>
        <div role="radiogroup" aria-label="Provider" className="mt-2 inline-flex rounded-xl bg-stage/5 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              onClick={() => choose(p.id)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${preset === p.id ? 'bg-white text-ink shadow-sm' : 'text-ink/60 hover:text-ink'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TextField fullWidth value={baseUrl} onChange={setBaseUrl} isReadOnly={preset !== 'custom'}>
        <Label>Base URL</Label>
        <Input placeholder="https://your-provider.example/v1" />
      </TextField>

      <TextField fullWidth type="password" value={apiKey} onChange={setApiKey}>
        <Label>API key</Label>
        <Input placeholder="Paste your API key" autoComplete="off" />
        <FieldError />
      </TextField>

      <ComboBox
        fullWidth
        allowsCustomValue
        menuTrigger="focus"
        inputValue={model}
        onInputChange={setModel}
        selectedKey={selected?.id ?? null}
        onSelectionChange={(key) => key && setModel(String(key))}
        items={models.filter((m) => !model || selected || m.id.toLowerCase().includes(model.toLowerCase()) || m.name.toLowerCase().includes(model.toLowerCase()))}
      >
        <Label>Model</Label>
        <ComboBox.InputGroup>
          <Input placeholder={loading ? 'Loading models…' : models.length ? 'Search models' : 'Enter the model id'} />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox renderEmptyState={() => <div className="px-3 py-2 text-sm text-ink/60">No matching models</div>}>
            {(m: ModelInfo) => (
              <ListBox.Item id={m.id} textValue={m.id}>
                <div className="flex flex-col">
                  <span className="text-sm">{m.name}</span>
                  {m.name !== m.id && <span className="text-xs text-ink/50">{m.id}</span>}
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>

      {loading && <p className="flex items-center gap-2 text-sm text-ink/60"><Spinner size="sm" /> Loading your models…</p>}
      {!loading && models.length > 0 && <p className="text-sm text-ink/60">{models.length} models available.</p>}
      {listError && <p role="alert" className="text-sm text-danger">{listError}</p>}
      {selected?.tools === false && <p className="text-sm text-ink/70">This model is listed without tool support, so it is likely to fail the test.</p>}

      {saveError && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>The model did not pass the test</Alert.Title>
            <Alert.Description>{saveError}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <Button size="lg" onPress={save} isPending={saving} isDisabled={!apiKey.trim() || !model.trim() || !baseUrl.trim()}>
        Test &amp; save
      </Button>
    </div>
  );
}

import { Alert, Button, Chip, Spinner, Tooltip } from '@heroui/react';
import { useStudio } from '../../lib/studio';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { notify } from '../../lib/notify';
import type { Attachment, Brand, BrandColor } from '../../lib/types';
import { PlusIcon, RefreshIcon, SparkIcon, TrashIcon, XIcon } from '../icons';

const ROLES: Array<{ id: BrandColor['role']; label: string }> = [
  { id: 'primary', label: 'Primary' },
  { id: 'secondary', label: 'Secondary' },
  { id: 'accent', label: 'Accent' },
  { id: 'background', label: 'Background' },
  { id: 'text', label: 'Text' },
  { id: 'gradient', label: 'Gradient stop' },
  { id: 'detected', label: 'Detected' },
  { id: 'avoid', label: 'Never use' },
];

const field = 'w-full rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-lumablue/50';

function Section({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink/[0.07] bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[13.5px] font-semibold">{title}</h4>
          {hint && <p className="text-[12px] text-ink/50">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ColorRow({ color, onChange, onRemove }: { color: BrandColor; onChange: (c: BrandColor) => void; onRemove: () => void }) {
  const [hex, setHex] = useState(color.hex);
  useEffect(() => setHex(color.hex), [color.hex]);
  const commit = (value: string) => {
    const v = value.startsWith('#') ? value : `#${value}`;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange({ ...color, hex: v.toUpperCase() });
    else setHex(color.hex);
  };
  return (
    <li className={`grid grid-cols-[44px_96px_1fr_120px_24px] items-center gap-2 rounded-xl p-1.5 ${color.role === 'avoid' ? 'bg-danger/[0.04]' : ''}`}>
      <label className="relative size-11 cursor-pointer overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgb(22_24_29/0.1)]" style={{ background: color.hex }} aria-label={`Pick ${color.name || color.hex}`}>
        <input type="color" value={color.hex.toLowerCase()} onChange={(e) => onChange({ ...color, hex: e.target.value.toUpperCase() })} className="absolute inset-0 cursor-pointer opacity-0" />
        {color.role === 'avoid' && <span className="absolute inset-0 grid place-items-center text-white/90"><XIcon size={20} /></span>}
      </label>
      <input aria-label="Hex" value={hex} onChange={(e) => setHex(e.target.value)} onBlur={(e) => commit(e.target.value.trim())} className={`${field} font-mono uppercase`} />
      <div className="min-w-0">
        <input aria-label="Colour name" value={color.name} placeholder="Name" onChange={(e) => onChange({ ...color, name: e.target.value })} className={field} />
        <input aria-label="Usage" value={color.usage} placeholder="Where to use it" onChange={(e) => onChange({ ...color, usage: e.target.value })} className={`${field} mt-1 text-[12px] text-ink/60`} />
      </div>
      <select aria-label="Role" value={color.role} onChange={(e) => onChange({ ...color, role: e.target.value as BrandColor['role'] })} className={`${field} ${color.role === 'avoid' ? 'text-danger' : ''}`}>
        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <button type="button" onClick={onRemove} aria-label="Remove colour" className="grid size-6 place-items-center rounded-md text-ink/35 hover:bg-ink/5 hover:text-danger"><TrashIcon size={14} /></button>
    </li>
  );
}

export function BrandTab({ projectId, attachments }: { projectId: string; attachments: Attachment[] }) {
  const { send, chat } = useStudio();
  const client = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['brand', projectId], queryFn: () => api.get<{ exists: boolean; brand: Brand }>(`/api/projects/${projectId}/brand`) });
  const [brand, setBrand] = useState<Brand | null>(null);
  const [dirty, setDirty] = useState(false);

  // Take server updates (detection after an upload, the Director's edits) unless the user is mid-edit.
  useEffect(() => {
    if (data && !dirty) setBrand(data.brand);
  }, [data, dirty]);

  const update = (patch: Partial<Brand>) => {
    setBrand((b) => (b ? { ...b, ...patch } : b));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: () => api.put<Brand>(`/api/projects/${projectId}/brand`, brand),
    onSuccess: (saved) => {
      setDirty(false);
      client.setQueryData(['brand', projectId], { exists: true, brand: saved });
      notify.success('brand.json saved. The Director follows it from the next step.');
    },
    onError: (e) => notify.error(e.message),
  });
  const rescan = useMutation({
    mutationFn: () => api.post<{ brand: Brand }>(`/api/projects/${projectId}/brand/rescan`),
    onSuccess: ({ brand: fresh }) => {
      setDirty(false);
      client.setQueryData(['brand', projectId], { exists: true, brand: fresh });
      notify.success('Scanned the brand files again');
    },
    onError: (e) => notify.error(e.message),
  });

  if (isLoading || !brand) return <div className="grid h-full place-items-center"><Spinner /></div>;
  const images = attachments.filter((a) => /^image\//.test(a.type));
  const unusedLogos = images.filter((a) => !brand.logos.some((l) => l.path === a.path));

  return (
    <div className="thin-scroll h-full overflow-y-auto p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Brand</h3>
          <p className="text-[12.5px] text-ink/50">
            Saved as <code className="font-mono">brand.json</code>. The Director must follow it, and keeps it up to date from your files{brand.updatedAt ? ` · updated ${timeAgo(brand.updatedAt)}` : ''}.
          </p>
        </div>
        <div className="flex gap-2">
          <Tooltip delay={300}>
            <Button size="sm" variant="ghost" isPending={rescan.isPending} onPress={() => rescan.mutate()}><RefreshIcon size={14} />Auto-detect</Button>
            <Tooltip.Content>Fill in colours, logos and rules from the files by rules, without the Director</Tooltip.Content>
          </Tooltip>
          <Button size="sm" variant="secondary" isDisabled={chat.running} onPress={() => void send('Read the brand material in this project (logos, guidelines, brand kits, references) and record the brand with update_brand: name, colours with roles and usage, gradients, fonts, which logo to use where, rules and tone. Use judgement, then tell me in a few lines what you recorded.')}><SparkIcon size={14} />Ask the Director</Button>
          <Button size="sm" isDisabled={!dirty} isPending={save.isPending} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>

      {!data?.exists && (
        <Alert className="mt-4" status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No brand yet</Alert.Title>
            <Alert.Description>Upload logos, guidelines (PDF or Markdown) or a zipped brand kit, then press Ask the Director: it reads them and records the brand here with judgement. You can also edit everything yourself.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Section title="Identity">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[12px] text-ink/55">Brand name<input value={brand.name} onChange={(e) => update({ name: e.target.value })} className={`${field} mt-1`} placeholder="Lumademy" /></label>
            <label className="text-[12px] text-ink/55">Tone of voice<input value={brand.tone} onChange={(e) => update({ tone: e.target.value })} className={`${field} mt-1`} placeholder="Calm, confident, friendly" /></label>
          </div>
        </Section>

        <Section
          title="Colours"
          hint="The Director must use these. Mark any colour “Never use” to keep it out of every video."
          action={<Button size="sm" variant="ghost" onPress={() => update({ colors: [...brand.colors, { name: '', hex: '#2970EC', role: 'secondary', usage: '' }] })}><PlusIcon size={14} />Add</Button>}
        >
          {brand.colors.length > 0 && (
            <div className="mb-3 flex h-10 overflow-hidden rounded-xl">
              {brand.colors.filter((c) => c.role !== 'avoid').map((c, i) => <div key={i} className="flex-1" style={{ background: c.hex }} title={`${c.name} ${c.hex}`} />)}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {brand.colors.map((c, i) => (
              <ColorRow
                key={i}
                color={c}
                onChange={(next) => update({ colors: brand.colors.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => update({ colors: brand.colors.filter((_, j) => j !== i) })}
              />
            ))}
          </ul>
          {brand.colors.length === 0 && <p className="text-[13px] text-ink/45">No colours yet.</p>}
        </Section>

        <Section title="Gradients" action={<Button size="sm" variant="ghost" onPress={() => update({ gradients: [...brand.gradients, 'linear-gradient(135deg, #5DAEFF 0%, #2970EC 50%, #1557D1 100%)'] })}><PlusIcon size={14} />Add</Button>}>
          <ul className="flex flex-col gap-2">
            {brand.gradients.map((g, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="h-9 w-16 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_rgb(22_24_29/0.08)]" style={{ background: g }} />
                <input aria-label="Gradient" value={g} onChange={(e) => update({ gradients: brand.gradients.map((x, j) => (j === i ? e.target.value : x)) })} className={`${field} font-mono text-[12px]`} />
                <button type="button" aria-label="Remove gradient" onClick={() => update({ gradients: brand.gradients.filter((_, j) => j !== i) })} className="text-ink/35 hover:text-danger"><TrashIcon size={14} /></button>
              </li>
            ))}
          </ul>
          {brand.gradients.length === 0 && <p className="text-[13px] text-ink/45">None.</p>}
        </Section>

        <Section title="Logos" hint="The Director places these files as they are and never redraws them.">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {brand.logos.map((l, i) => (
              <li key={l.path} className="overflow-hidden rounded-xl border border-ink/[0.07]">
                <div className="checker grid h-24 place-items-center p-3"><img src={`/api/projects/${projectId}/files/${l.path}`} alt="" className="max-h-full max-w-full object-contain" /></div>
                <div className="flex items-center gap-1 p-2">
                  <input aria-label="When to use" value={l.use} placeholder="When to use" onChange={(e) => update({ logos: brand.logos.map((x, j) => (j === i ? { ...x, use: e.target.value } : x)) })} className={`${field} py-1 text-[12px]`} />
                  <button type="button" aria-label="Remove logo" onClick={() => update({ logos: brand.logos.filter((_, j) => j !== i) })} className="text-ink/35 hover:text-danger"><XIcon size={14} /></button>
                </div>
                <p className="truncate px-2 pb-2 font-mono text-[10.5px] text-ink/40">{l.path}</p>
              </li>
            ))}
          </ul>
          {unusedLogos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-ink/45">Add from assets:</span>
              {unusedLogos.slice(0, 12).map((a) => (
                <button key={a.path} type="button" onClick={() => update({ logos: [...brand.logos, { path: a.path, use: '' }] })}>
                  <Chip size="sm" variant="secondary"><Chip.Label>+ {a.name}</Chip.Label></Chip>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Fonts" action={<Button size="sm" variant="ghost" onPress={() => update({ fonts: [...brand.fonts, { family: '', role: 'headings' }] })}><PlusIcon size={14} />Add</Button>}>
          <ul className="flex flex-col gap-2">
            {brand.fonts.map((f, i) => (
              <li key={i} className="grid grid-cols-[1fr_140px_24px] items-center gap-2">
                <input aria-label="Font family" value={f.family} placeholder="Inter" onChange={(e) => update({ fonts: brand.fonts.map((x, j) => (j === i ? { ...x, family: e.target.value } : x)) })} className={field} style={{ fontFamily: f.family || undefined }} />
                <input aria-label="Font role" value={f.role} placeholder="headings" onChange={(e) => update({ fonts: brand.fonts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} className={field} />
                <button type="button" aria-label="Remove font" onClick={() => update({ fonts: brand.fonts.filter((_, j) => j !== i) })} className="text-ink/35 hover:text-danger"><TrashIcon size={14} /></button>
              </li>
            ))}
          </ul>
          {brand.fonts.length === 0 && <p className="text-[13px] text-ink/45">Inter is built in. Upload .woff2/.ttf files to use your own.</p>}
        </Section>

        <Section title="Rules" hint="One rule per line. Shown to the Director as must-follow.">
          <textarea
            aria-label="Brand rules"
            value={brand.rules.join('\n')}
            onChange={(e) => update({ rules: e.target.value.split('\n').map((r) => r.trimStart()).filter((r, i, all) => r || i === all.length - 1) })}
            rows={Math.max(3, brand.rules.length + 1)}
            className={`${field} leading-relaxed`}
            placeholder={'Do not stretch or rotate the logo\nKeep clear space of 1/4 of the symbol width'}
          />
        </Section>

        {brand.sources.length > 0 && <p className="px-1 text-[11.5px] text-ink/40">Read from: {brand.sources.join(', ')}</p>}
      </div>
    </div>
  );
}

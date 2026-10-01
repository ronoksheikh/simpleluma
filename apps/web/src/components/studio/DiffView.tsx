interface FileDiff {
  path: string;
  lines: Array<{ kind: 'add' | 'del' | 'hunk' | 'ctx'; text: string }>;
}

/** Split a unified diff (from `git show` or the Director's edit tools) into files and classified lines. */
function parse(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git')) {
      current = { path: line.replace(/^diff --git a\/(.*) b\/.*$/, '$1'), lines: [] };
      files.push(current);
    } else if (line.startsWith('Index:') || line.startsWith('====')) {
      continue;
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      if (!current && line.startsWith('+++ ')) files.push((current = { path: line.slice(4).replace(/^b\//, '').split('\t')[0]!, lines: [] }));
    } else if (current) {
      if (line.startsWith('@@')) current.lines.push({ kind: 'hunk', text: line });
      else if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1) });
      else if (line.startsWith('-')) current.lines.push({ kind: 'del', text: line.slice(1) });
      else if (line.startsWith(' ')) current.lines.push({ kind: 'ctx', text: line.slice(1) });
    }
  }
  return files;
}

const STYLE = {
  add: 'bg-emerald-50 text-emerald-900',
  del: 'bg-rose-50 text-rose-900',
  hunk: 'bg-lumablue/5 text-lumablue',
  ctx: 'text-ink/70',
} as const;

const MARK = { add: '+', del: '−', hunk: ' ', ctx: ' ' } as const;

export function DiffView({ patch }: { patch: string }) {
  const files = parse(patch);
  if (files.length === 0) return <p className="px-3 py-2 text-sm text-ink/55">No changes.</p>;
  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-xl border border-ink/10 bg-white">
          <div className="border-b border-ink/10 bg-ink/[0.03] px-3 py-1.5 font-mono text-xs font-medium">{file.path}</div>
          <div className="thin-scroll max-h-96 overflow-auto font-mono text-xs leading-5">
            {file.lines.map((l, i) => (
              <div key={i} className={`flex whitespace-pre px-3 ${STYLE[l.kind]}`}>
                <span className="w-4 shrink-0 select-none opacity-60">{MARK[l.kind]}</span>
                <span>{l.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

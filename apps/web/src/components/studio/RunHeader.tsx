import { Popover, ProgressCircle, Spinner } from '@heroui/react';
import { useMemo } from 'react';
import { timeAgo, tokens } from '../../lib/format';
import { useStudio } from '../../lib/studio';
import type { Todo } from '../../lib/types';
import { BrainIcon, CheckIcon, ChevronIcon, ListIcon } from '../icons';

function Ring({ value, label }: { value: number; label: string }) {
  return (
    <ProgressCircle value={Math.round(value * 100)} aria-label={label} size="sm" className="shrink-0">
      <ProgressCircle.Track>
        <ProgressCircle.TrackCircle />
        <ProgressCircle.FillCircle />
      </ProgressCircle.Track>
    </ProgressCircle>
  );
}

function TodoRow({ todo, index }: { todo: Todo; index: number }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      {todo.status === 'done' ? (
        <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-success text-white"><CheckIcon size={11} /></span>
      ) : todo.status === 'in_progress' ? (
        <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center"><Spinner size="sm" /></span>
      ) : (
        <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-ink/20 text-[10px] text-ink/40">{index + 1}</span>
      )}
      <span className={`text-[13px] leading-snug ${todo.status === 'done' ? 'text-ink/45 line-through decoration-ink/20' : todo.status === 'in_progress' ? 'font-medium' : 'text-ink/80'}`}>{todo.text}</span>
    </li>
  );
}

const tile = 'flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lumablue/40';

/** Plan, activity and token use for the Director, at a glance, with details on click. */
export function RunHeader() {
  const { chat, setTab } = useStudio();
  const todos = chat.todos;
  const done = todos.filter((t) => t.status === 'done').length;
  const current = todos.find((t) => t.status === 'in_progress') ?? todos.find((t) => t.status === 'pending');
  const run = chat.run;
  const step = chat.running ? chat.step : run?.steps ?? 0;
  const limit = chat.running ? chat.stepLimit : run?.stepLimit ?? chat.stepLimit;
  const runIn = run?.promptTokens ?? 0;
  const runOut = run?.completionTokens ?? 0;
  const total = chat.usage.prompt + chat.usage.completion;
  // The size of the latest request is how much of the model's context the job is using right now.
  const context = useMemo(() => [...chat.messages].reverse().find((m) => m.usage)?.usage ?? null, [chat.messages]);

  const status = chat.running
    ? { title: chat.activity ?? 'Working', sub: `Step ${step} of ${limit}` }
    : !run ? { title: 'Ready when you are', sub: 'No runs yet' }
    : run.status === 'done' ? { title: `Finished in ${run.steps} ${run.steps === 1 ? 'step' : 'steps'}`, sub: run.endedAt ? timeAgo(run.endedAt) : '' }
    : run.status === 'paused' ? { title: 'Paused at the step limit', sub: `${run.steps} of ${run.stepLimit} steps · press Continue` }
    : run.status === 'interrupted' ? { title: 'Interrupted by a restart', sub: 'Continue to pick up' }
    : run.status === 'stopped' ? { title: 'Stopped', sub: `after ${run.steps} steps` }
    : { title: 'Last run failed', sub: run.reason?.slice(0, 60) ?? '' };

  return (
    <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto] items-center gap-1 border-b border-ink/[0.06] px-2 py-1.5">
      <Popover>
        <Popover.Trigger className={tile} aria-label="Plan">
          {todos.length && done === todos.length ? <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success/10 text-success"><CheckIcon size={15} /></span>
            : todos.length ? <Ring value={done / todos.length} label="Plan progress" /> : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink/[0.04] text-ink/40"><ListIcon size={16} /></span>}
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink/40">
              Plan{todos.length > 0 && <span className="tabular-nums normal-case tracking-normal">{done}/{todos.length}</span>}
            </span>
            <span className={`block truncate text-[13px] ${todos.length && done === todos.length ? 'text-success' : 'text-ink/85'}`}>
              {!todos.length ? 'The Director plans as it starts' : done === todos.length ? 'Plan complete' : current?.text}
            </span>
          </span>
          <ChevronIcon size={12} className="ml-auto shrink-0 rotate-90 text-ink/30" />
        </Popover.Trigger>
        <Popover.Content placement="bottom start" className="w-[340px]">
          <Popover.Dialog className="p-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold">Plan</p>
              {todos.length > 0 && <span className="text-[12px] tabular-nums text-ink/50">{done} of {todos.length} done</span>}
            </div>
            {todos.length ? (
              <ol className="thin-scroll mt-2 max-h-72 overflow-y-auto">{todos.map((t, i) => <TodoRow key={t.id} todo={t} index={i} />)}</ol>
            ) : (
              <p className="mt-2 text-[12.5px] text-ink/55">No plan yet. For bigger jobs the Director writes a checklist first and keeps it current.</p>
            )}
            <button type="button" onClick={() => setTab('plan')} className="mt-2 text-[12.5px] font-medium text-lumablue hover:text-royal">Open the Plan tab →</button>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      <div className={`${tile} cursor-default hover:bg-transparent`} aria-live="polite">
        {chat.running ? <Ring value={limit ? step / limit : 0} label="Steps used" /> : (
          <span className={`grid size-8 shrink-0 place-items-center rounded-full ${run?.status === 'failed' ? 'bg-danger/10 text-danger' : run?.status === 'done' ? 'bg-success/10 text-success' : 'bg-ink/[0.04] text-ink/40'}`}>
            {run?.status === 'done' ? <CheckIcon size={14} /> : <span className="text-[11px] font-semibold tabular-nums">{step}</span>}
          </span>
        )}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink/40">
            {chat.running && <span className="pulse-dot size-1.5 rounded-full bg-lumablue" />}{chat.running ? 'Working' : 'Status'}
          </span>
          <span className={`block truncate text-[13px] ${chat.running ? 'shimmer-text' : 'text-ink/85'}`}>{status.title}</span>
          <span className="block truncate text-[11.5px] text-ink/45">{status.sub}</span>
        </span>
      </div>

      <Popover>
        <Popover.Trigger className={tile} aria-label="Token usage">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lumablue/[0.08] text-lumablue"><BrainIcon size={16} /></span>
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-ink/40">Tokens</span>
            <span className="block text-[13px] font-medium tabular-nums">{tokens(chat.running ? runIn + runOut : total)}</span>
          </span>
        </Popover.Trigger>
        <Popover.Content placement="bottom end" className="w-[300px]">
          <Popover.Dialog className="p-3">
            <p className="text-[13px] font-semibold">Token usage</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-[12.5px]">
              <dt className="text-ink/40" />
              <dd className="text-right text-[11px] uppercase tracking-wide text-ink/40">In</dd>
              <dd className="text-right text-[11px] uppercase tracking-wide text-ink/40">Out</dd>
              {run && <><dt className="text-ink/60">{chat.running ? 'This run' : 'Last run'}</dt><dd className="text-right tabular-nums">{tokens(runIn)}</dd><dd className="text-right tabular-nums">{tokens(runOut)}</dd></>}
              <dt className="text-ink/60">All {chat.usage.runs} runs</dt><dd className="text-right tabular-nums">{tokens(chat.usage.prompt)}</dd><dd className="text-right tabular-nums">{tokens(chat.usage.completion)}</dd>
            </dl>
            {context && (
              <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2">
                <div className="flex justify-between text-[12px]"><span className="text-ink/60">Context in use</span><span className="tabular-nums font-medium">{tokens(context.prompt)}</span></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-sky to-lumablue" style={{ width: `${Math.min(100, (context.prompt / 128_000) * 100)}%` }} /></div>
                <p className="mt-1.5 text-[11px] text-ink/45">Size of the latest request, against a 128k window. Older steps are trimmed automatically; plan, checkpoints and memory always stay.</p>
              </div>
            )}
            {context?.estimated && <p className="mt-2 text-[11px] text-ink/45">Your provider does not report usage, so these are estimates.</p>}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}

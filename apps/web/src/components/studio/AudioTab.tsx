import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { VoiceClip } from '../../lib/types';

export function AudioTab({ projectId }: { projectId: string }) {
  const { data: files = [] } = useQuery({ queryKey: ['files', projectId], queryFn: () => api.get<string[]>(`/api/projects/${projectId}/files`) });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ elevenLabs: { configured: boolean } }>('/api/settings') });
  const clipPaths = files.filter((f) => /^audio\/voice\/[^/]+\.json$/.test(f));
  const clips = useQueries({
    queries: clipPaths.map((path) => ({
      queryKey: ['voice-clip', projectId, path, files.length],
      queryFn: () => api.get<VoiceClip>(`/api/projects/${projectId}/files/${path}`),
    })),
  });
  const hasScore = files.includes('audio.js');

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl bg-white p-5 shadow-[0_2px_12px_-4px_rgb(7_23_56/0.08)]">
        <h3 className="font-medium">Music and effects</h3>
        <p className="mt-1 text-sm text-night/60">{hasScore ? 'This video has a Web Audio score (audio.js). It plays in the preview and is mixed into renders.' : 'No score yet. Ask Luma for music or sound effects.'}</p>
      </section>
      <section>
        <h3 className="mb-2 px-1 font-medium">Voice-over</h3>
        {clipPaths.length === 0 ? (
          <div className="rounded-3xl bg-white p-5 text-sm text-night/60 shadow-[0_2px_12px_-4px_rgb(7_23_56/0.08)]">
            {settings?.elevenLabs.configured ? (
              'No voice lines yet. Ask Luma to add a voice-over: each line is generated with word timings so captions and animations follow the speech.'
            ) : (
              <>Add an ElevenLabs key in <Link to="/settings" className="font-medium text-lumablue hover:text-royal">Settings</Link> and Luma can narrate your video.</>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {clips.map((q, i) =>
              q.data ? (
                <li key={clipPaths[i]} className="rounded-3xl bg-white p-5 shadow-[0_2px_12px_-4px_rgb(7_23_56/0.08)]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{clipPaths[i]!.replace('audio/voice/', '').replace('.json', '')}</span>
                    <span className="text-sm text-night/55">at {q.data.at.toFixed(1)}s · {q.data.duration.toFixed(1)}s · {q.data.words.length} words</span>
                  </div>
                  <p className="mt-2 text-sm text-night/75">{q.data.text}</p>
                  <audio controls preload="none" src={`/api/projects/${projectId}/files/audio/voice/${q.data.file}`} className="mt-3 w-full" />
                </li>
              ) : null,
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

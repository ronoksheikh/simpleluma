import { useNavigate } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import { ModelForm } from '../components/ModelForm';

export function SetupModelPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-xl px-6 pb-16 pt-14">
      <LogoMark size={44} className="rounded-2xl" />
      <h1 className="wordmark mt-5 text-[30px]">Connect the Director's model</h1>
      <p className="mt-2 text-[14.5px] text-ink/55">
        The Director runs on any OpenAI-compatible model that supports tool calling (OpenRouter, OpenAI, or a local server). Reasoning models show their thinking. Your key is stored encrypted on this server.
      </p>
      <div className="panel mt-8 p-6">
        <ModelForm onSaved={() => navigate('/')} />
      </div>
    </div>
  );
}

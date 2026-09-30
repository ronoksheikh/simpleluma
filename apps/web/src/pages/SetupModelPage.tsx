import { useNavigate } from 'react-router-dom';
import { ModelForm } from '../components/ModelForm';

export function SetupModelPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-xl px-6 pb-16 pt-6">
      <h1 className="wordmark text-3xl">Connect your model</h1>
      <p className="mt-2 text-night/60">
        Luma Studio works with any OpenAI-compatible model that supports tool calling. Your key is stored encrypted on this server.
      </p>
      <div className="mt-8 rounded-3xl bg-white p-7 shadow-[0_10px_40px_-12px_rgb(7_23_56/0.12)]">
        <ModelForm onSaved={() => navigate('/')} />
      </div>
    </div>
  );
}

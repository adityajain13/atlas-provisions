import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage, requestLoginCode, verifyLoginCode } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { ctaBtn, fieldCls } from '../components/ui';
import { useSession } from '../session';

const CODE_MINUTES = 15;

type Step = 'email' | 'code';

export default function Login() {
  const { setSignedIn } = useSession();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // The worker sends ?expired=1 when a one-tap link is old or already used
  const [error, setError] = useState<string | null>(
    params.get('expired') ? 'That link expired or was already used.' : null,
  );

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await requestLoginCode(email.trim());
      setStep('code');
    } catch (err) {
      setError(navigator.onLine ? errorMessage(err) : "You're offline");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(value = code) {
    setBusy(true);
    setError(null);
    try {
      const r = await verifyLoginCode(email.trim(), value);
      setSignedIn(r.email); // the app gate then leaves the login page
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  // Digits only, six of them; the sixth signs in straight away (as in Atlas Journeys)
  function onCodeInput(raw: string) {
    const v = raw.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    if (v.length === 6) void signIn(v);
  }

  function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    void sendCode();
  }

  function useDifferentEmail() {
    setStep('email');
    setCode('');
    setError(null);
  }

  return (
    <Page centered>
      <Header title="Sign in" desktopBrand />

      <div className="mt-10 space-y-4">
        {step === 'email' ? (
          <form onSubmit={onEmailSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={fieldCls}
            />
            <button type="submit" disabled={busy} className={ctaBtn}>
              Send code
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => onCodeInput(e.target.value)}
              placeholder="••••••"
              aria-label="6-digit code"
              className={`${fieldCls} text-center font-mono text-[24px] tracking-[0.5em]`}
            />
            <button type="button" onClick={() => void signIn()} disabled={busy || code.length !== 6} className={ctaBtn}>
              Sign in
            </button>
            <p className="text-[13px] text-muted">
              Check your email for a code. It expires in {CODE_MINUTES} minutes.
            </p>
            <div className="flex items-center justify-between text-[14px]">
              <button type="button" onClick={useDifferentEmail} className="min-h-11 text-muted hover:text-paper">
                Different email
              </button>
              <button type="button" onClick={() => void sendCode()} disabled={busy} className="min-h-11 text-muted hover:text-paper disabled:opacity-40">
                Resend
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-herb px-3 py-2 text-[14px] text-[#D98C7A]">
            {error}
          </p>
        )}
      </div>
    </Page>
  );
}

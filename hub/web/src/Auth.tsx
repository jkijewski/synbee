import { useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import { Import } from './Import';

export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'password' | 'import'>('password');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== repeat) return setError("The passwords don't match.");
    try {
      await api('POST', '/api/auth/setup', { password });
      setStep('import');
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  if (step === 'import') {
    return (
      <div className="narrow">
        <div className="card card-body mb-3">
          <h2>Step 2 of 2: Import device names (optional)</h2>
          <p className="muted">Upload the devices.json from tinytuya, so re-paired devices keep their names. You can also do this later.</p>
        </div>
        <Import />
        <button className="btn btn-primary btn-sm" onClick={onDone}>
          Finish
        </button>
      </div>
    );
  }
  return (
    <form className="card card-body mb-3 narrow" onSubmit={submit}>
      <h2>Step 1 of 2: Set the admin password</h2>
      <p className="muted">This password protects the hub on your home network. Use at least 10 characters.</p>
      <label>
        Password
        <input className="form-control form-control-sm" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
      </label>
      <label>
        Repeat password
        <input className="form-control form-control-sm" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={10} />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <button className="btn btn-primary btn-sm">Set password</button>
    </form>
  );
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/login', { password });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  return (
    <form className="card card-body mb-3 narrow" onSubmit={submit}>
      <h2>Sign in to SynBee</h2>
      <label>
        Password
        <input className="form-control form-control-sm" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <button className="btn btn-primary btn-sm">Sign in</button>
      <p className="muted">
        Forgot the password? A DSM administrator can reset it: in Package Center, install the SynBee package again (or a newer version) and
        tick "Reset the hub's admin password" in the wizard. Devices, actions and automations are kept.
      </p>
    </form>
  );
}

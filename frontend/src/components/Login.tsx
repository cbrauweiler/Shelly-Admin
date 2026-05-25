import { useState } from 'react'
import { login, loginMfa } from '../api'
import { Button, Field, inputClass, ErrorText } from './ui'

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<'password' | 'mfa'>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await login(username.trim(), password)
      if (res.mfaRequired) {
        setStep('mfa')
        setBusy(false)
      } else {
        onSuccess()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login fehlgeschlagen')
      setBusy(false)
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await loginMfa(code.trim())
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code ungültig')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel/85 p-6 shadow-xl shadow-black/30 backdrop-blur">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-update/20 text-xl">
            ⚡
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none">Shelly-Admin</h1>
            <p className="mt-1 text-xs text-muted">
              {step === 'mfa' ? 'Zwei-Faktor-Code eingeben' : 'Bitte anmelden'}
            </p>
          </div>
        </div>

        {step === 'password' ? (
          <form onSubmit={submitPassword}>
            <Field label="Benutzername">
              <input
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </Field>
            <Field label="Passwort">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" variant="primary" disabled={busy || !username || !password} className="mt-4 w-full">
              {busy ? 'Anmelden …' : 'Anmelden'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitMfa}>
            <Field label="6-stelliger Code oder Recovery-Code">
              <input
                className={inputClass}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="123456"
                autoFocus
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" variant="primary" disabled={busy || code.trim().length < 6} className="mt-4 w-full">
              {busy ? 'Prüfe …' : 'Bestätigen'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep('password')
                setError('')
                setCode('')
              }}
              className="mt-3 w-full text-center text-xs text-muted hover:text-white"
            >
              ← Zurück
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

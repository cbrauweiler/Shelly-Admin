import { useState } from 'react'
import { setup, type MfaProvisioning } from '../api'
import { Button, Field, inputClass, ErrorText } from './ui'
import { MfaEnroll } from './MfaEnroll'

/** Erst-Aufruf: Admin-Konto anlegen, optional mit MFA. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [enableMfa, setEnableMfa] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [provisioning, setProvisioning] = useState<MfaProvisioning | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('Passwörter stimmen nicht überein.')
    if (password.length < 8) return setError('Passwort: mindestens 8 Zeichen.')
    setBusy(true)
    setError('')
    try {
      const res = await setup(username.trim(), password, enableMfa)
      if (res.mfa) setProvisioning(res.mfa)
      else onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup fehlgeschlagen')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel/85 p-6 shadow-xl shadow-black/30 backdrop-blur">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-update/20 text-2xl">
            ⚡
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none">Shelly-Admin einrichten</h1>
            <p className="mt-1 text-xs text-muted">
              {provisioning ? 'Zwei-Faktor-Authentifizierung aktivieren' : 'Administrator-Konto anlegen'}
            </p>
          </div>
        </div>

        {provisioning ? (
          <MfaEnroll provisioning={provisioning} onConfirmed={onDone} onSkip={onDone} />
        ) : (
          <form onSubmit={submit}>
            <Field label="Benutzername">
              <input
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </Field>
            <Field label="Passwort (min. 8 Zeichen)">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Passwort bestätigen">
              <input
                className={inputClass}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <label className="mb-1 flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={enableMfa} onChange={(e) => setEnableMfa(e.target.checked)} />
              Zwei-Faktor-Authentifizierung (TOTP) aktivieren
            </label>
            <ErrorText>{error}</ErrorText>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || username.trim().length < 3 || password.length < 8}
              className="mt-4 w-full"
            >
              {busy ? 'Lege an …' : 'Konto anlegen'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

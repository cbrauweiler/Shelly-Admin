import { useEffect, useState } from 'react'
import { account, beginMfa, disableMfa, changePassword, type MfaProvisioning } from '../api'
import { Modal, Button, Field, inputClass, ErrorText } from './ui'
import { MfaEnroll } from './MfaEnroll'

/** Kontoeinstellungen: MFA aktivieren/deaktivieren. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ username: string; mfaEnabled: boolean } | null>(null)
  const [mode, setMode] = useState<'view' | 'enroll' | 'disable' | 'password'>('view')
  const [provisioning, setProvisioning] = useState<MfaProvisioning | null>(null)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () => account().then(setInfo).catch(() => {})
  useEffect(() => {
    reload()
  }, [])

  async function startEnroll() {
    setBusy(true)
    setError('')
    try {
      setProvisioning(await beginMfa())
      setMode('enroll')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  async function doDisable() {
    setBusy(true)
    setError('')
    try {
      await disableMfa(password)
      setPassword('')
      setMode('view')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  async function doChangePassword() {
    if (newPassword !== confirm) return setError('Neue Passwörter stimmen nicht überein.')
    if (newPassword.length < 8) return setError('Neues Passwort: mindestens 8 Zeichen.')
    setBusy(true)
    setError('')
    try {
      await changePassword(password, newPassword)
      setPassword('')
      setNewPassword('')
      setConfirm('')
      setPwMsg('Passwort geändert.')
      setMode('view')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Konto & Sicherheit" onClose={onClose}>
      {mode === 'enroll' && provisioning ? (
        <MfaEnroll
          provisioning={provisioning}
          onConfirmed={() => {
            setMode('view')
            reload()
          }}
          onSkip={() => setMode('view')}
        />
      ) : mode === 'disable' ? (
        <div>
          <p className="mb-3 text-sm text-muted">Passwort eingeben, um MFA zu deaktivieren.</p>
          <Field label="Passwort">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={doDisable} disabled={busy || !password} className="flex-1">
              MFA deaktivieren
            </Button>
            <Button variant="ghost" onClick={() => setMode('view')}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : mode === 'password' ? (
        <div>
          <p className="mb-3 text-sm text-muted">Anmelde-Passwort des Admins ändern.</p>
          <Field label="Aktuelles Passwort">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
          </Field>
          <Field label="Neues Passwort (min. 8 Zeichen)">
            <input className={inputClass} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Neues Passwort bestätigen">
            <input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={doChangePassword} disabled={busy || !password || !newPassword} className="flex-1">
              {busy ? 'Speichere …' : 'Passwort ändern'}
            </Button>
            <Button variant="ghost" onClick={() => { setMode('view'); setError(''); setNewPassword(''); setConfirm('') }}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-panel2/60 px-3 py-2 text-sm">
            <span className="text-muted">Angemeldet als </span>
            <span className="font-semibold">{info?.username ?? '…'}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line bg-panel2/60 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Zwei-Faktor (TOTP)</div>
              <div className="text-xs text-muted">
                {info?.mfaEnabled ? 'Aktiv – beim Login wird ein Code verlangt.' : 'Nicht aktiv.'}
              </div>
            </div>
            {info?.mfaEnabled ? (
              <Button variant="danger" onClick={() => setMode('disable')}>
                Deaktivieren
              </Button>
            ) : (
              <Button variant="primary" onClick={startEnroll} disabled={busy}>
                Aktivieren
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line bg-panel2/60 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Passwort</div>
              <div className="text-xs text-muted">{pwMsg || 'Anmelde-Passwort des Admins ändern.'}</div>
            </div>
            <Button onClick={() => { setMode('password'); setPwMsg(''); setError('') }}>Ändern</Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted">
            Passwort & MFA vergessen? Admin im Backend per{' '}
            <code className="text-accent">node src/reset-admin.js</code> zurücksetzen – die Geräteliste bleibt erhalten.
          </p>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Modal>
  )
}

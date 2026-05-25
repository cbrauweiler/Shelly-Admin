import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { enableMfa, type MfaProvisioning } from '../api'
import { Button, Field, inputClass, ErrorText } from './ui'

/**
 * Zeigt QR-Code + Secret + Recovery-Codes und verlangt einen Bestätigungs-Code,
 * um MFA scharfzuschalten. Wird im Setup-Wizard und in den Kontoeinstellungen genutzt.
 */
export function MfaEnroll({
  provisioning,
  onConfirmed,
  onSkip,
}: {
  provisioning: MfaProvisioning
  onConfirmed: () => void
  onSkip?: () => void
}) {
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedCodes, setSavedCodes] = useState(false)

  useEffect(() => {
    QRCode.toDataURL(provisioning.otpauthUrl, { margin: 1, width: 200 })
      .then(setQr)
      .catch(() => setQr(''))
  }, [provisioning.otpauthUrl])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await enableMfa(code.trim())
      onConfirmed()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code ungültig')
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Scanne den QR-Code mit deiner Authenticator-App (Google Authenticator, Aegis, 1Password …)
        oder gib das Secret manuell ein.
      </p>

      <div className="mb-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {qr ? (
          <img src={qr} alt="TOTP-QR-Code" className="rounded-lg bg-white p-1" width={160} height={160} />
        ) : (
          <div className="grid h-40 w-40 place-items-center rounded-lg bg-panel2 text-xs text-muted">QR …</div>
        )}
        <div className="flex-1">
          <div className="text-xs text-muted">Secret (manuell)</div>
          <code className="mt-1 block break-all rounded-lg border border-line bg-panel2 px-2 py-1.5 text-xs text-accent">
            {provisioning.secret}
          </code>
          <div className="mt-3 text-xs text-muted">Recovery-Codes (einmalig anzeigen!)</div>
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-warn/30 bg-warn/5 p-2 font-mono text-[11px] text-warn">
            {provisioning.recoveryCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
            Ich habe die Recovery-Codes sicher gespeichert.
          </label>
        </div>
      </div>

      <Field label="Bestätigungscode aus der App">
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

      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={confirm} disabled={busy || code.trim().length < 6 || !savedCodes} className="flex-1">
          {busy ? 'Prüfe …' : 'MFA aktivieren'}
        </Button>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Später
          </Button>
        )}
      </div>
    </div>
  )
}

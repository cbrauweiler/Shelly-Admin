import type { ReactNode } from 'react'

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'default',
  disabled,
  className = '',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  className?: string
  title?: string
}) {
  const styles: Record<string, string> = {
    default: 'border border-line bg-panel2 text-slate-200 hover:bg-line',
    primary: 'bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30',
    danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
    ghost: 'text-muted hover:text-white hover:bg-panel2',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-line bg-panel p-5 shadow-2xl shadow-black/40`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted transition hover:text-white" title="Schließen">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent'

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="mt-2 text-sm text-danger">{children}</p> : null
}

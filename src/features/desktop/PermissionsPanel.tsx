import { useEffect, useState } from 'react'
import { Check, Monitor, RotateCw, ShieldAlert, Wrench } from 'lucide-react'
import {
  desktop,
  permissionProblem,
  screenSettingName,
  type DesktopPermissions,
  type PermissionState,
} from '@/lib/desktop'
import { Button, ErrorNote } from '@/components/ui'

/*
  What has to be in place before the app can punch in, with a button for each.
  It checks again every two seconds, so the list ticks itself off as the
  employee works through it.

  macOS: Screen Recording and Accessibility in System Settings (asked again
  after every update, because an unsigned app counts as a new one).
  Linux: the one-time setup (administrator password), and on Wayland choosing
  the screen once in the desktop's own window.
*/
export function PermissionsPanel() {
  const [permissions, setPermissions] = useState<DesktopPermissions | null>(null)

  useEffect(() => {
    if (!desktop) return
    const bridge = desktop
    let cancelled = false
    const read = () =>
      bridge
        .permissions()
        .then((value) => !cancelled && setPermissions(value))
        .catch(() => undefined)
    void read()
    const timer = window.setInterval(read, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  if (!desktop || !permissions) return null
  const bridge = desktop
  const blocking = permissionProblem(permissions)
  if (bridge.platform === 'linux') {
    if (!blocking && permissions.setup !== 'advised') return null
    return <LinuxPanel permissions={permissions} blocking={Boolean(blocking)} onChange={setPermissions} />
  }
  if (!blocking) return null

  if (permissions.session === 'wayland') {
    return (
      <Panel title="Before you can punch in">
        <p>
          This computer is signed in with Wayland, which the app cannot work with. Sign out, choose{' '}
          <strong>Ubuntu on Xorg</strong> with the gear button on the sign-in screen, sign in again and
          reopen the app.
        </p>
      </Panel>
    )
  }

  async function allow(kind: 'screen' | 'input') {
    setPermissions(await bridge.requestPermission(kind))
  }

  return (
    <Panel title="Before you can punch in">
      <p>Allow Softus Checkin in System Settings → Privacy &amp; Security:</p>
      <ul className="mt-2 space-y-1.5">
        <Row label={screenSettingName()} state={permissions.screen} onAllow={() => allow('screen')} />
        <Row label="Accessibility" state={permissions.input} onAllow={() => allow('input')} />
      </ul>
      {permissions.restartNeeded && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-rule pt-2">
          <span>Restart the app to finish.</span>
          <Button size="sm" onClick={() => bridge.relaunch()}>
            <RotateCw className="size-3.5" />
            Restart
          </Button>
        </div>
      )}
    </Panel>
  )
}

function LinuxPanel({
  permissions,
  blocking,
  onChange,
}: {
  permissions: DesktopPermissions
  blocking: boolean
  onChange: (next: DesktopPermissions) => void
}) {
  const [running, setRunning] = useState<'setup' | 'screen' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const bridge = desktop!
  const setupDone = permissions.setup === 'ok'
  const needsScreen = permissions.screen !== 'granted'

  async function runSetup() {
    if (!bridge.runSetup) return
    setRunning('setup')
    setMessage(null)
    const result = await bridge.runSetup()
    setRunning(null)
    if (!result.ok) {
      setMessage(
        result.cancelled
          ? 'The administrator password was not entered. Ask whoever manages this computer to run the setup.'
          : 'The setup did not finish. Ask whoever manages this computer to run it.',
      )
    }
    onChange(await bridge.permissions())
  }

  async function chooseScreen() {
    setRunning('screen')
    setMessage(null)
    const next = await bridge.requestPermission('screen')
    setRunning(null)
    if (next.screen !== 'granted') setMessage('No screen was chosen. Choose your screen and click Share.')
    onChange(next)
  }

  return (
    <Panel title={blocking ? 'Before you can punch in' : 'Finish setting up this computer'}>
      <ul className="space-y-3">
        <Step
          done={setupDone}
          icon={<Wrench className="size-3.5" aria-hidden />}
          label="Set up this computer"
          hint="Needs an administrator password, once."
          action={
            <Button size="sm" variant="secondary" className="w-full" loading={running === 'setup'} disabled={running !== null} onClick={runSetup}>
              Set up
            </Button>
          }
        />
        {needsScreen && (
          <Step
            done={false}
            icon={<Monitor className="size-3.5" aria-hidden />}
            label="Choose your screen"
            hint="Pick it once in the window that opens; it is remembered."
            action={
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                loading={running === 'screen'}
                disabled={running !== null || !setupDone}
                onClick={chooseScreen}
              >
                Choose
              </Button>
            }
          />
        )}
      </ul>
      {message && <ErrorNote className="mt-2" message={message} />}
    </Panel>
  )
}

function Step({
  done,
  icon,
  label,
  hint,
  action,
}: {
  done: boolean
  icon: React.ReactNode
  label: string
  hint: string
  action: React.ReactNode
}) {
  return (
    <li className="space-y-1.5">
      <span className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0">
          {done ? <Check className="size-3.5 text-status-green" aria-label="Done" /> : icon}
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-ink-800">{label}</span>
          {!done && <span className="block text-ink-400">{hint}</span>}
        </span>
      </span>
      {!done && action}
    </li>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-rule bg-ink-50/70 px-3 py-2 text-[12px] text-ink-600"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}

export function Row({
  label,
  state,
  onAllow,
}: {
  label: string
  state: PermissionState
  onAllow: () => void
}) {
  const granted = state === 'granted'
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        {granted ? (
          <Check className="size-3.5 text-status-green" aria-label="Allowed" />
        ) : (
          <span className="size-3.5 rounded-full border border-ink-300" aria-label="Not allowed yet" />
        )}
        {label}
      </span>
      {!granted && (
        <Button size="sm" variant="secondary" onClick={onAllow}>
          Allow
        </Button>
      )}
    </li>
  )
}

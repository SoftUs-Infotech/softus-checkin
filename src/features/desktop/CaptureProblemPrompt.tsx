import { useEffect, useState } from 'react'
import { RotateCw, Settings } from 'lucide-react'
import { logEvent } from '@/lib/appLog'
import { problemTitle, useCaptureProblem } from '@/lib/captureProblem'
import { desktop, screenSettingName, type DesktopPermissions } from '@/lib/desktop'
import { Button, Modal } from '@/components/ui'
import { Row } from './PermissionsPanel'

/*
  "Please allow this setting" — shown by the desktop app when it punched
  somebody out because it lost the screen, or when a punch-in failed because it
  could not see the screen. It says only which setting to allow (and, where
  macOS needs it, to restart the app); never why.

  macOS: the two settings with an Allow button each, ticking themselves off as
  they are allowed, then Restart. When macOS reports both allowed and the app
  still could not see the screen, turning the setting off and on again is
  what fixes it.
*/
export function CaptureProblemPrompt() {
  const { open, reason, punchedOut, close } = useCaptureProblem()
  const [permissions, setPermissions] = useState<DesktopPermissions | null>(null)
  const platform = desktop?.platform
  const title = problemTitle(platform)

  useEffect(() => {
    if (open) logEvent('POPUP_SHOWN', { title })
  }, [open, title])

  useEffect(() => {
    if (!open || !desktop || platform !== 'darwin') return
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
  }, [open, platform])

  if (!desktop || !open) return null
  const bridge = desktop

  async function allow(kind: 'screen' | 'input') {
    setPermissions(await bridge.requestPermission(kind))
  }
  const restart = () => void bridge.relaunch()
  const punchedOutLine = punchedOut ? 'You have been punched out. ' : ''

  if (platform === 'win32') {
    return (
      <Modal
        open
        onClose={close}
        title={title}
        footer={
          <Button onClick={restart}>
            <RotateCw className="size-4" />
            Restart
          </Button>
        }
      >
        <p className="text-[13px] text-ink-600">{punchedOutLine}Restart the app and punch in again.</p>
      </Modal>
    )
  }

  if (platform === 'linux') {
    return (
      <Modal open onClose={close} title={title} footer={<Button onClick={close}>OK</Button>}>
        <p className="text-[13px] text-ink-600">
          {punchedOutLine}Punch in again and choose your screen when asked.
        </p>
      </Modal>
    )
  }

  // macOS
  const allAllowed = permissions?.screen === 'granted' && permissions?.input === 'granted'
  if (reason === 'SCREEN_NOT_VISIBLE' && permissions && allAllowed) {
    // Allowed as far as macOS says, yet the screen could not be seen.
    return (
      <Modal
        open
        onClose={close}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={() => void bridge.openPermissionSettings('screen')}>
              <Settings className="size-4" />
              Open Settings
            </Button>
            <Button onClick={restart}>
              <RotateCw className="size-4" />
              Restart
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[13px] text-ink-600">
          {punchedOut && <p>You have been punched out.</p>}
          <p>
            In System Settings → Privacy &amp; Security → {screenSettingName()}, turn Softus Checkin off and on
            again, then restart the app and punch in.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={close} title={title} footer={<Button onClick={close}>OK</Button>}>
      <div className="space-y-3 text-[13px] text-ink-600">
        <div className="space-y-1">
          {punchedOut && <p>You have been punched out.</p>}
          <p>Allow Softus Checkin in System Settings → Privacy &amp; Security, then punch in again.</p>
        </div>
        <ul className="space-y-1.5">
          <Row label={screenSettingName()} state={permissions?.screen ?? 'unknown'} onAllow={() => allow('screen')} />
          <Row label="Accessibility" state={permissions?.input ?? 'unknown'} onAllow={() => allow('input')} />
        </ul>
        {permissions && allAllowed && permissions.restartNeeded && (
          <div className="flex items-center justify-between gap-2 border-t border-rule pt-2">
            <span>Restart the app to finish.</span>
            <Button size="sm" onClick={restart}>
              <RotateCw className="size-3.5" />
              Restart
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * bootFailureNotice — the audio engine failing to start reaches the user, once,
 * with the only action that recovers it (#1218).
 *
 * ⚠ TWO KINDS OF ARM, AND EACH BREAK MUST REDDEN A DIFFERENT KIND. The
 * behaviour arms below drive the helper directly and are structurally blind to
 * whether production still calls it — reverting the call site would leave every
 * one of them green while the user saw nothing. The wiring arms at the bottom
 * cover exactly that gap and can say nothing about whether the dialog is right.
 * Neither kind alone closes this; identical verdicts from the two breaks would
 * mean one of them is decoration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isBootStepFailure } from '@stave/editor'
import { reportBootFailure, resetBootFailureNotice } from '../bootFailureNotice'
import {
  closeDialog,
  getDialog,
  resolveConfirm,
  showPrompt,
} from '../host'

/**
 * A failure shaped exactly as `createRequiredStep` brands one.
 *
 * ⚠ A HAND-MADE FIXTURE IS A SECOND ORACLE UNLESS SOMETHING TIES IT DOWN — it
 * would keep passing while the real brand was renamed and production quietly
 * fell back to the generic error path. Two things tie it: the first arm below
 * runs it through PRODUCTION's own predicate, and the editor's own suite drives
 * the real producer (`StrudelEngine.test.ts`, "a failed required step is
 * branded"). Neither this file nor that one is sufficient alone.
 */
function bootFailure(step = '@strudel/transpiler', deadlineMs = 3000): Error {
  const err = new Error(
    `[StrudelEngine] boot step "${step}" did not answer within ${deadlineMs}ms.`,
  ) as Error & { bootStep: string; bootStepDeadlineMs: number }
  err.bootStep = step
  err.bootStepDeadlineMs = deadlineMs
  return err
}

describe('bootFailureNotice — behaviour', () => {
  beforeEach(() => {
    resetBootFailureNotice()
    closeDialog()
  })
  afterEach(() => closeDialog())

  it('the fixture is what production calls a boot failure, not a local guess', () => {
    expect(isBootStepFailure(bootFailure())).toBe(true)
  })

  it('raises a dialog naming the step, with a reload and a way to carry on', () => {
    expect(reportBootFailure(bootFailure(), () => {})).toBe(true)
    const d = getDialog()
    expect(d?.kind).toBe('confirm')
    expect(d?.title).toBe("The audio engine didn't start.")
    // the step and its ceiling, so the detail line is not a generic apology
    expect(d?.description).toContain('@strudel/transpiler')
    expect(d?.description).toContain('3s')
    expect(d?.kind === 'confirm' && d.confirmLabel).toBe('Reload')
    // "Cancel" would be wrong — nothing is being undone
    expect(d?.kind === 'confirm' && d.cancelLabel).toBe('Continue without audio')
  })

  it('says a never-attempted step ran out of budget rather than inventing a timeout', () => {
    reportBootFailure(bootFailure('initAudio', 0), () => {})
    expect(getDialog()?.description).toContain('never attempted')
  })

  it('leaves every other error alone — this adds a surface, it does not swallow', () => {
    expect(reportBootFailure(new Error('reference error in user code'), () => {})).toBe(false)
    expect(reportBootFailure('not even an error', () => {})).toBe(false)
    expect(getDialog()).toBeNull()
  })

  it('raises once per document, however many callers rediscover the failure', () => {
    reportBootFailure(bootFailure(), () => {})
    closeDialog() // the user dismisses it
    // the warm-up, then Play, then a re-evaluation all report the same failure
    expect(reportBootFailure(bootFailure(), () => {})).toBe(true)
    expect(reportBootFailure(bootFailure(), () => {})).toBe(true)
    expect(getDialog()).toBeNull()
  })

  it('reloads when the user takes the reload, and not otherwise', () => {
    let reloads = 0
    reportBootFailure(bootFailure(), () => {
      reloads += 1
    })
    resolveConfirm(true)
    return Promise.resolve().then(() => {
      expect(reloads).toBe(1)
    })
  })

  it('does not reload when the user chooses to carry on without audio', () => {
    let reloads = 0
    reportBootFailure(bootFailure(), () => {
      reloads += 1
    })
    closeDialog() // the dismiss path resolves the confirm with false
    return Promise.resolve().then(() => {
      expect(reloads).toBe(0)
    })
  })

  it('settles a dialog it displaces instead of stranding whoever awaits it', async () => {
    // `dialog` is a single slot: assigning a new one drops the old, and the
    // dropped promise would never settle — the #1193 shape, one layer up.
    const pending = showPrompt({ title: 'Rename file', initialValue: 'x' })
    reportBootFailure(bootFailure(), () => {})
    await expect(pending).resolves.toBeNull()
    expect(getDialog()?.title).toBe("The audio engine didn't start.")
  })
})

describe('bootFailureNotice — wiring', () => {
  const client = readFileSync(
    join(__dirname, '..', '..', 'components', 'StrudelEditorClient.tsx'),
    'utf8',
  )

  /**
   * ⚠ These say only that production still ROUTES through the helper. They
   * cannot say the dialog is correct — that is the behaviour arms' job — and
   * saying so here is what keeps a green wiring arm from reading as proof the
   * feature works.
   */
  it('the idle warm-up reports a boot failure rather than swallowing it', () => {
    expect(client).toContain('reportBootFailure')
    // the bare swallow this replaced is what made a dead engine reach the user
    // as silence; if it comes back, the warm-up path goes quiet again
    expect(client).not.toContain('.catch(() => {}); // warm-up is best-effort')
  })

  it("the runtime's error channel reports a boot failure", () => {
    const onError = client.slice(client.indexOf('runtime.onError('))
    expect(onError.slice(0, 600)).toContain('reportBootFailure(err)')
  })
})

"use strict"
// stop-on-quit: stop the OpenCode background service when the desktop app is closed.
//
// GUI part of the plugin (the `./gui-experimental` entry, loaded as a plain file at the plugin
// root because this directory has no package.json). The desktop app evaluates this file and runs
// `main` once, in the Electron main process, as an app-wide singleton.
//
// No build step and no npm install: the app provides `@opencode/plugin/gui` in both processes and
// node built-ins in the main process. Windows evaluate this file too, where node built-ins are
// inert placeholders, so every require stays at module scope and is only *used* inside `main`.
const { Plugin } = require("@opencode/plugin/gui")
const { spawn } = require("node:child_process")

const DEFAULTS = {
  dryRun: false, // armed: actually run `service stop` when the app exits
  stopOnLastWindowClose: true, // the app closing its last window is the trigger
  stopOnAppQuit: true, // belt and braces: also act on app quit, guarded to skip plugin reloads
  settleMs: 750, // let the window count settle before deciding, so a reload is not mistaken for a quit
  cliPath: "", // optional CLI override; defaults to ctx.cli.command
}

module.exports = Plugin.define({
  i18n: { en: { title: "Stop On Quit" } },

  main(ctx) {
    const opt = { ...DEFAULTS, ...(ctx.options || {}) }
    const log = (level, message, data) => {
      try {
        ctx.log.write(level, message, data)
      } catch {}
    }

    let fired = false

    const stop = (reason) => {
      if (fired) return
      fired = true

      const base = opt.cliPath ? [String(opt.cliPath)] : ctx.cli && ctx.cli.command ? [...ctx.cli.command] : []
      const exe = base.shift()
      const args = [...base, "service", "stop"]
      log("info", "stop-on-quit: " + reason, { exe, args, dryRun: !!opt.dryRun })
      if (opt.dryRun || !exe || !spawn) return

      try {
        // Detached so the CLI survives the app exiting, and unref'd so nothing waits on it.
        const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true })
        child.unref()
      } catch (error) {
        log("error", "stop-on-quit: spawn failed: " + (error && error.message))
      }
    }

    const windows = () => {
      try {
        return ctx.windows.list()
      } catch {
        return []
      }
    }

    log("info", "stop-on-quit: armed", {
      dryRun: !!opt.dryRun,
      stopOnLastWindowClose: !!opt.stopOnLastWindowClose,
      stopOnAppQuit: !!opt.stopOnAppQuit,
      cli: ctx.cli,
    })

    // Closing the last window is the trigger the request describes.
    if (opt.stopOnLastWindowClose) {
      ctx.windows.on("close", () => {
        setTimeout(() => {
          if (windows().length === 0) stop("last window closed")
        }, opt.settleMs)
      })
    }

    // Quit cleanup also runs when the plugin itself is disabled, reloaded, or removed, so only
    // act when nothing is left holding a window; a reload always keeps the window open.
    if (opt.stopOnAppQuit) {
      ctx.onCleanup(() => {
        if (windows().length === 0) stop("app quit")
      })
    }
  },
})

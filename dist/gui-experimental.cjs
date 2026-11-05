"use strict"
// stop-on-quit — OpenCode Desktop plugin
//
// Stops the OpenCode background service (`opencode service stop`) when the desktop app exits,
// so the service does not outlive the app that started it.
//
// This file is the plugin's `./gui-experimental` part. The desktop app evaluates it in two
// places: each window runs `setup`, and the Electron main process runs `main`. All the work
// happens in `main`, because that is the only place with:
//   - a documented lifecycle callback for the app quitting (`ctx.onCleanup`)
//   - window open/close events (`ctx.windows`)
//   - the CLI path the app itself runs (`ctx.cli`)
//   - Node built-ins (`node:child_process`), which the app provides
//
// A server-part-only plugin cannot do this: plugins run inside the server, so they never
// receive `server.connected`, and the plugin context has no client, service, or shutdown
// domain. The server part is therefore optional here, and this plugin ships without one.
//
// No build step and no runtime dependencies: the app provides `@opencode/plugin/gui` and the
// Node built-ins at runtime. Windows evaluate this file too, where Node built-ins are inert
// placeholders, so every require stays at module scope and is only *used* inside `main`.

const { Plugin } = require("@opencode/plugin/gui")
const { spawn } = require("node:child_process")

const DEFAULTS = {
  dryRun: false, // log the decision instead of running the command; useful for verifying the hook
  stopOnLastWindowClose: true, // closing the last window is the trigger most people expect
  stopOnAppQuit: true, // belt and braces; guarded so a plugin reload cannot masquerade as a quit
  settleMs: 750, // let the window count settle before deciding
  cliPath: "", // optional CLI override; defaults to the CLI the desktop app reports
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

    const windows = () => {
      try {
        return ctx.windows.list()
      } catch {
        return []
      }
    }

    const stop = (reason) => {
      if (fired) return
      fired = true

      const base = opt.cliPath ? [String(opt.cliPath)] : ctx.cli && ctx.cli.command ? [...ctx.cli.command] : []
      const exe = base.shift()
      const args = [...base, "service", "stop"]
      log("info", "stop-on-quit: " + reason, { exe, args, dryRun: !!opt.dryRun })
      if (opt.dryRun || !exe || !spawn) return

      try {
        // Detached and unref'd so the CLI finishes after the app has exited; `main`'s
        // async cleanup may only delay quitting for at most three seconds.
        const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true })
        child.unref()
      } catch (error) {
        log("error", "stop-on-quit: spawn failed: " + (error && error.message))
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

# opencode-stop-on-quit

A plugin for the **OpenCode Desktop app** that stops the shared background service when the desktop app exits.

## The problem

On the desktop app, the OpenCode server is not a child of the app — it is a **shared background
service** that every client connects to (the desktop windows, a terminal TUI, JetBrains via ACP,
SDK clients). When you close the app, that service stays running with everything it spawned:
MCP servers, PTYs, model/agent bookkeeping. It also **respawns MCP servers on every boot**,
so an MCP server that is slow (or that starts a browser, an indexer, a CAD process) gets
restarted every single time anything starts OpenCode — and it keeps working in the background,
using CPU, long after you closed the window.

There is no setting for this. The service is managed manually (`opencode service start|stop|status`),
and per the docs nothing stops it when the last client exits.

**This plugin fixes that:** close the desktop app → the plugin runs `service stop` → the
background service shuts down → nothing OpenCode-related is left running.

## How it works

It is the plugin's **GUI part** (`./gui-experimental` export). The desktop app evaluates that
entry in two places — each window runs `setup`, the **Electron main process** runs `main` — and
all the work happens in `main`, because that is the only place with a documented quit callback,
window events, and Node built-ins:

- `ctx.onCleanup(fn)` — documented to fire when the plugin is disabled, reloaded, or removed,
  **or the app quits**; an `async` cleanup may delay quitting for up to 3 seconds
- `ctx.windows.on("close", ...)` / `ctx.windows.list()` — real window-close events
- `ctx.cli` — the CLI the app itself runs, so this plugin runs the documented `service stop`
- `node:child_process` — provided by the app in the main process

A **server-part-only plugin cannot do this**: plugins run inside the server, so they never
receive `server.connected`, and the plugin context has no client, service, or shutdown domain.

Two guards so it can't misfire:

- quit cleanup also runs on a plugin **reload/disable**, so it only acts when **zero windows
  remain** — a reload always leaves windows open
- a `fired` flag means it can only trigger **once per app lifetime**

The stop command is spawned **detached and unref'd**, so it finishes after the app exits.

## Operating systems

| Platform | Status |
| --- | --- |
| **Windows** | ✅ **Tested and verified working** — OpenCode Desktop 2.2.5 (x64), plugin loaded from `~/.config/opencode/plugins/`, verified end-to-end (plugin decision logged at quit, old service PID gone, app started a fresh service on reopen) |
| **macOS** | Should work — nothing in the code is OS-specific and the plugin declares no `os` restriction — but **untested** |
| **Linux** | Same as macOS: expected, **untested** |

**Desktop app only.** It hooks the Electron main process, so terminal/TUI-only usage has nothing
to trigger it (those are separate clients on the same shared service anyway).

## Install

No build step and **no runtime dependencies** — the app provides `@opencode/plugin/gui` and the
Node built-ins at runtime.

### Recommended: drop it in the global plugins directory (this is what is tested)

Create a directory named `stop-on-quit` in the global plugins directory below, put
`dist/gui-experimental.cjs` inside it (that directory must **not** contain a `package.json`), and
add it to `plugin` (or `plugins`) in `~/.config/opencode/opencode.json`:

| OS | Plugins directory | Config file |
| --- | --- | --- |
| Windows | `C:\Users\<you>\.config\opencode\plugins\stop-on-quit\gui-experimental.cjs` | `C:\Users\<you>\.config\opencode\opencode.json` |
| macOS / Linux | `~/.config/opencode/plugins/stop-on-quit/gui-experimental.cjs` | `~/.config/opencode/opencode.json` |

```json
{
  "plugin": ["./plugins/stop-on-quit"]
}
```

Use the **directory name as the plugin id** (as above). Verified on 2.2.5.
Caveat: for a package with no server part the plugin id comes from the **package name**, and ids
in the reserved `opencode` namespace (e.g. `opencode-stop-on-quit`) will **not load the GUI part**.
The tested-working form is therefore the plain file / directory install, which is also what the
docs describe for global plugins.

### From npm / GitHub

```json
{
  "plugin": ["opencode-stop-on-quit"]
}
```

Same caveat as above — if the GUI part does not load under the package name, use the file install
and open an issue.

## Options

Put them in the config entry for the plugin (the plugin reads them from `ctx.options`).
The `dryRun` option is the recommended way to confirm the wiring before letting it act.

| Option | Default | Meaning |
| --- | --- | --- |
| `dryRun` | `false` | Log the decision, do not run the command. Flip to `false` to arm. |
| `stopOnLastWindowClose` | `true` | Stop the service when the **last** window closes |
| `stopOnAppQuit` | `true` | Also stop on app quit (guarded: only when zero windows remain) |
| `settleMs` | `750` | Let the window count settle before deciding |
| `cliPath` | *(empty)* | Override the CLI binary; defaults to the CLI the desktop app reports |

## Verify it (recipe)

1. Set `"dryRun": true`, close and reopen the app.
2. Close the app and reopen it, then check the **newest** desktop log directory
   (`~/AppData/Roaming/ai.opencode.desktop/logs/<stamp>/main.log` on Windows,
   `~/.local/share/…` style paths elsewhere): you want to see the plugin arm on startup **and** the
   decision line from the launch that quit — e.g. `stop-on-quit: app quit { exe: …, dryRun: true }`.
3. Set `"dryRun": false`. On the next close, `opencode-cli service status` should report a new
   PID/port (the old service is gone, the app had to start a fresh one).

## What it means in practice

- Closing the app **ends every session running on that shared service** — including sessions
  you left open in another window, and clients like JetBrains Connect or a terminal TUI.
- A background service the app started on its own (e.g. for a TUI) will also be stopped.
- The GUI plugin API is documented as **experimental** and may change between OpenCode releases.

## Troubleshooting

- **Nothing happens on quit** — confirm the plugin is loaded (`opencode plugin list`), check the
  desktop `main.log` for the `stop-on-quit: armed` line, and try `dryRun: true` first.
- **It stopped my other client's session** — that is the shared service; set
  `"stopOnLastWindowClose": false` and keep `stopOnAppQuit` if you only want quit-triggered stops.
- **Plugin not loading from a package name** — see the namespace caveat above; use the file install.

## Uninstall

Remove the entry from `~/.config/opencode/opencode.json` and delete the plugin directory.

## License

MIT — see [LICENSE](./LICENSE).

# Auth Debug Test Build

This debug branch is intended for temporary auth and refresh diagnostics.

It combines:

- `fkhr79/node-red-contrib-alexa-remote2-applestrudel#test/auth-debug-5.1.0`
- `fkhr79/alexa-cookie#test/cumulative-auth-fixes-debug` as `alexa-cookie2` override

`alexa-cookie2` is configured only through `npm overrides`. Do not install the
`alexa-cookie2` debug tarball as a direct dependency; npm can reject that setup
when the same package is both a direct dependency and an override target.

## Before you start

1. Open a terminal on the machine where Node-RED is installed.
2. Change into the Node-RED user directory.
3. Back up `package.json` and `package-lock.json`.
4. Install the Applestrudel debug package and configure the `alexa-cookie2` debug override.
5. Set `APPLESTRUDEL_AUTH_DEBUG_DIR` before starting Node-RED.
6. Restart Node-RED.
7. Reproduce the login or refresh problem once.
8. Run the collector and share the generated bundle.
9. Restore the previous packages after the debug run.
10. Remove the temporary debug log and bundle after you no longer need them.

Do not paste passwords, cookies, tokens, SMS codes, raw logs, terminal output, full URLs, query strings, fragments, or browser session data into an issue.

## Find the Node-RED user directory

Use the directory that contains your Node-RED `package.json`.

Common locations:

- Linux/macOS: `~/.node-red`
- Docker containers: often `/data`
- Home Assistant Community add-on: often `/config`
- Windows: `%USERPROFILE%\.node-red`

If Node-RED runs in Docker, Home Assistant, Proxmox, or another Linux container, run the Linux commands inside that environment. Do not use the Windows commands for a Linux container just because the host machine is Windows.

Before installing, check that the current directory contains the Node-RED `package.json`.

## Install on Linux, macOS, Docker, or Home Assistant

Run this in the Node-RED user directory:

```sh
set -e
test -f package.json
if [ -f package.json.auth-debug-backup ] || [ -f package-lock.json.auth-debug-backup ]; then
  echo "auth debug backup already exists; restore or move it before continuing"
  exit 1
fi
cp package.json package.json.auth-debug-backup
if [ -f package-lock.json ]; then cp package-lock.json package-lock.json.auth-debug-backup; fi
npm install --save \
  https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/auth-debug-5.1.0.tar.gz
npm pkg set overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz
npm install
```

Do not restart Node-RED yet. Configure the debug log location first, then restart Node-RED with that environment active.

## Install on Windows PowerShell

Open PowerShell and run this in the Node-RED user directory.

For a normal Windows Node-RED installation this is:

```powershell
cd "$env:USERPROFILE\.node-red"
```

Then install the debug packages:

Use `npm.cmd` in PowerShell. This avoids problems with the optional `npm.ps1` PowerShell wrapper and execution policy settings.
If PowerShell says that `npm.cmd` was not found, close and reopen PowerShell after installing Node.js, or add the Node.js installation directory to `PATH`.

```powershell
$ErrorActionPreference = "Stop"
if (-not (Test-Path package.json)) {
  throw "package.json not found; change into the Node-RED user directory first"
}
if ((Test-Path package.json.auth-debug-backup) -or (Test-Path package-lock.json.auth-debug-backup)) {
  throw "auth debug backup already exists; restore or move it before continuing"
}
Copy-Item package.json package.json.auth-debug-backup
if (Test-Path package-lock.json) { Copy-Item package-lock.json package-lock.json.auth-debug-backup }
npm.cmd install --save `
  "https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/auth-debug-5.1.0.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
npm.cmd pkg set "overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "npm pkg set failed" }
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
```

Do not restart Node-RED yet. Configure the debug log location first, then restart Node-RED with that environment active.

## Log location

File logging is opt-in. No `authdbg.jsonl` file is written unless you set `APPLESTRUDEL_AUTH_DEBUG_DIR` or `APPLESTRUDEL_AUTH_DEBUG_LOG` before starting Node-RED.

If you set only `APPLESTRUDEL_AUTH_DEBUG_DIR`, the log file is `authdbg.jsonl` inside that directory. This is the recommended setup.

If you set only `APPLESTRUDEL_AUTH_DEBUG_LOG`, that exact file path is used.

If you set both variables, `APPLESTRUDEL_AUTH_DEBUG_LOG` defines the actual file path. Use both only if you really need a custom file name.

Without overrides, the collector's default lookup path is based on Node.js `os.tmpdir()`:

```sh
node -e "const os=require('os'),path=require('path'); console.log(path.join(os.tmpdir(),'applestrudel-auth-debug','authdbg.jsonl'))"
```

Run this command inside the same environment that starts Node-RED. In many Linux containers this prints `/tmp/applestrudel-auth-debug/authdbg.jsonl`; on Windows it usually prints a path below `%TEMP%`.

For a debug run, set one explicit debug directory in the environment that starts the Node-RED process. An interactive `export` or `$env:...` is enough only when you start Node-RED manually from that same terminal. If Node-RED is started by a service, container, or add-on supervisor, configure the variable there and restart through that service, container, or add-on.

Linux/macOS/Docker/Home Assistant:

```sh
export APPLESTRUDEL_AUTH_DEBUG_DIR=/tmp/applestrudel-auth-debug
```

For plain Docker, pass the variable when the container starts, for example:

```sh
docker run -e APPLESTRUDEL_AUTH_DEBUG_DIR=/tmp/applestrudel-auth-debug ...
```

For Docker Compose, add the variable to the Node-RED service:

```yaml
environment:
  APPLESTRUDEL_AUTH_DEBUG_DIR: /tmp/applestrudel-auth-debug
```

For Home Assistant add-ons, add the variable in the add-on's supported environment or options configuration if available. If the add-on does not expose persistent environment variables, this file-based debug mode cannot be enabled reliably through the add-on alone. In that case, run Node-RED in an environment where `APPLESTRUDEL_AUTH_DEBUG_DIR` or `APPLESTRUDEL_AUTH_DEBUG_LOG` can be set before process start.

Windows PowerShell:

```powershell
$env:APPLESTRUDEL_AUTH_DEBUG_DIR="$env:TEMP\applestrudel-auth-debug"
```

Restart Node-RED only after the variable is configured in the environment that actually starts Node-RED.

If you start Node-RED manually from PowerShell, stop it with `Ctrl+C` and start it again from the same PowerShell window after setting `$env:APPLESTRUDEL_AUTH_DEBUG_DIR`.
If Node-RED runs as a Windows service, configure the variable for that service first, then restart that service. For services, prefer an explicit file path such as `C:\Temp\applestrudel-auth-debug\authdbg.jsonl` via `APPLESTRUDEL_AUTH_DEBUG_LOG`; a later interactive PowerShell may not see the service environment.

## Reproduce the problem

After Node-RED has restarted:

1. Open the Alexa account node configuration.
2. Start the cookie/login process.
3. Go through the login exactly once.
4. Note the final browser origin and path only, without query string and without fragment.
5. Note the visible error message or success message.
6. Do not paste your password, cookies, tokens, SMS code, full URL, query string, fragment, or browser session data anywhere.

Example:

```sh
http://192.168.0.35:3456/www.amazon.de/ap/maplanding
```

Do not share anything after `?` or `#` from a browser URL.

## Confirm the log was written

Before collecting, make sure the current reproduction was actually written to the log file. The file should exist, have a size greater than zero, and have a modification time after your reproduction.

Linux, macOS, Docker, or Home Assistant:

```sh
log="${APPLESTRUDEL_AUTH_DEBUG_LOG:-${APPLESTRUDEL_AUTH_DEBUG_DIR:+$APPLESTRUDEL_AUTH_DEBUG_DIR/authdbg.jsonl}}"
test -s "$log"
ls -l "$log"
```

Windows PowerShell:

```powershell
$Log = $env:APPLESTRUDEL_AUTH_DEBUG_LOG
if (-not $Log -and $env:APPLESTRUDEL_AUTH_DEBUG_DIR) {
  $Log = Join-Path $env:APPLESTRUDEL_AUTH_DEBUG_DIR "authdbg.jsonl"
}
if (-not $Log) {
  throw "APPLESTRUDEL_AUTH_DEBUG_DIR or APPLESTRUDEL_AUTH_DEBUG_LOG is not set in this PowerShell"
}
Get-Item -LiteralPath "$Log" | Select-Object FullName, Length, LastWriteTime
```

If Node-RED runs as a Windows service and this PowerShell does not know the service environment, set `$Log` manually to the exact `APPLESTRUDEL_AUTH_DEBUG_LOG` path configured for the service before running `Get-Item`.

If the file is missing, empty, or older than the reproduction, stop here. The debug environment is not active in the Node-RED process that handled the login or refresh attempt.

## Collect a sanitized bundle on Linux or macOS

After reproducing the issue, run this in the Node-RED user directory:

```sh
set -e
log="${APPLESTRUDEL_AUTH_DEBUG_LOG:-${APPLESTRUDEL_AUTH_DEBUG_DIR:+$APPLESTRUDEL_AUTH_DEBUG_DIR/authdbg.jsonl}}"
test -n "$log"
./node_modules/.bin/applestrudel-auth-debug-collect --log "$log" --out /tmp
```

## Collect a sanitized bundle in Docker

Run the collector inside the Node-RED container, in the Node-RED user directory.

For many Node-RED containers this directory is `/data`.

Collect to `/data` so the generated bundle is in the persistent Node-RED user directory:

```sh
set -e
cd /data
test -f package.json
log="${APPLESTRUDEL_AUTH_DEBUG_LOG:-${APPLESTRUDEL_AUTH_DEBUG_DIR:+$APPLESTRUDEL_AUTH_DEBUG_DIR/authdbg.jsonl}}"
test -n "$log"
./node_modules/.bin/applestrudel-auth-debug-collect --log "$log" --out /data
```

If you use plain Docker from the host, copy the generated archive from the container after the collector has printed `tarFile=...`.

## Collect a sanitized bundle in Home Assistant

Run the collector inside the Node-RED add-on shell, in the Node-RED user directory.

For the Home Assistant Community add-on this directory is often `/config`:

```sh
set -e
cd /config
test -f package.json
log="${APPLESTRUDEL_AUTH_DEBUG_LOG:-${APPLESTRUDEL_AUTH_DEBUG_DIR:+$APPLESTRUDEL_AUTH_DEBUG_DIR/authdbg.jsonl}}"
test -n "$log"
./node_modules/.bin/applestrudel-auth-debug-collect --log "$log" --out /config
```

## Collect a sanitized bundle on Windows PowerShell

After reproducing the issue, run this in the Node-RED user directory:

```powershell
$ErrorActionPreference = "Stop"
$Log = $env:APPLESTRUDEL_AUTH_DEBUG_LOG
if (-not $Log -and $env:APPLESTRUDEL_AUTH_DEBUG_DIR) {
  $Log = Join-Path $env:APPLESTRUDEL_AUTH_DEBUG_DIR "authdbg.jsonl"
}
if (-not $Log) {
  # For a Windows service, set this to the exact APPLESTRUDEL_AUTH_DEBUG_LOG path configured for that service.
  # Example:
  # $Log = "C:\Temp\applestrudel-auth-debug\authdbg.jsonl"
}
if (-not $Log) {
  throw "APPLESTRUDEL_AUTH_DEBUG_DIR or APPLESTRUDEL_AUTH_DEBUG_LOG is not set; set one before starting Node-RED and before running the collector"
}
.\node_modules\.bin\applestrudel-auth-debug-collect.cmd --log "$Log" --out "$env:TEMP"
if ($LASTEXITCODE -ne 0) { throw "collector failed" }
```

The collector prints:

- `bundleDir=...`
- `tarFile=...` if a `.tar.gz` archive was created

On current Windows versions, `tarFile=...` should normally be printed. If no `tarFile=...` line appears, open the printed `bundleDir=...` folder and create a zip file from that folder manually.

## What to share in the issue

Use the existing issue where the debug run was requested. If there is no existing issue, open one in `https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/issues`.

Share:

1. The generated `.tar.gz` or zip file.
2. Your operating system.
3. Your Node.js version from `node --version`.
4. Your Node-RED version.
5. Your Amazon region, for example `amazon.de`, `amazon.com`, or `amazon.co.uk`.
6. The login method you used, for example password only, app approval, SMS code, or 2FA app.
7. The final browser origin and path only. Remove the entire query string and fragment.
8. The visible browser message.

Do not share raw `authdbg.jsonl`, terminal output, full browser URLs, query strings, fragments, cookies, tokens, passwords, SMS codes, or screenshots containing those values.

Check the generated files locally before sharing them. The collector masks known auth values again, but local paths and environment details can still be sensitive in some environments.

Before uploading, search the generated bundle locally for suspicious leftovers such as `?`, `#`, `://`, `code=`, `state=`, `cookie`, `token`, `session`, `csrf`, and your email address. If you find anything sensitive, redact it first.

## Restore after the debug run

Restore the package files you backed up before installing the debug build.

Linux, macOS, Docker, or Home Assistant:

```sh
set -e
had_lock=0
if [ -f package-lock.json.auth-debug-backup ]; then had_lock=1; fi
cp package.json.auth-debug-backup package.json
if [ -f package-lock.json.auth-debug-backup ]; then cp package-lock.json.auth-debug-backup package-lock.json; else rm -f package-lock.json; fi
npm install
if [ "$had_lock" -eq 0 ]; then rm -f package-lock.json; fi
rm -f package.json.auth-debug-backup package-lock.json.auth-debug-backup
```

Windows PowerShell:

```powershell
$ErrorActionPreference = "Stop"
$hadLock = Test-Path package-lock.json.auth-debug-backup
Copy-Item package.json.auth-debug-backup package.json
if ($hadLock) {
  Copy-Item package-lock.json.auth-debug-backup package-lock.json
} elseif (Test-Path package-lock.json) {
  Remove-Item package-lock.json
}
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
if (-not $hadLock -and (Test-Path package-lock.json)) {
  Remove-Item package-lock.json
}
Remove-Item package.json.auth-debug-backup
if (Test-Path package-lock.json.auth-debug-backup) { Remove-Item package-lock.json.auth-debug-backup }
```

Restart Node-RED again after restoring the previous package state.

## Remove temporary debug artifacts

After the bundle has been handed over and you no longer need local diagnostics, remove the temporary debug artifacts from the machine where Node-RED ran.

Also remove `APPLESTRUDEL_AUTH_DEBUG_DIR` or `APPLESTRUDEL_AUTH_DEBUG_LOG` from any persistent start configuration you changed for the debug run, such as Docker Compose, a container start command, an add-on option, or a Windows service environment. Restart Node-RED once more after removing the variable so file logging is disabled again.

Linux, macOS, Docker, or Home Assistant:

```sh
log="${APPLESTRUDEL_AUTH_DEBUG_LOG:-${APPLESTRUDEL_AUTH_DEBUG_DIR:+$APPLESTRUDEL_AUTH_DEBUG_DIR/authdbg.jsonl}}"
if [ -n "$log" ]; then
  rm -f "$log"
fi
```

Windows PowerShell:

```powershell
$Log = $env:APPLESTRUDEL_AUTH_DEBUG_LOG
if (-not $Log -and $env:APPLESTRUDEL_AUTH_DEBUG_DIR) {
  $Log = Join-Path $env:APPLESTRUDEL_AUTH_DEBUG_DIR "authdbg.jsonl"
}
if (-not $Log) {
  # For a Windows service, set this to the exact APPLESTRUDEL_AUTH_DEBUG_LOG path configured for that service.
  # Example:
  # $Log = "C:\Temp\applestrudel-auth-debug\authdbg.jsonl"
}
if ($Log) {
  Remove-Item -LiteralPath "$Log" -ErrorAction SilentlyContinue
}
```

Also delete the generated `bundleDir=...` directory and the `tarFile=...` or zip file after the issue no longer needs them.

# Auth Debug Test Build

This debug branch is intended for temporary auth and refresh diagnostics.

It combines:

- `fkhr79/node-red-contrib-alexa-remote2-applestrudel#test/cumulative-auth-fixes-debug`
- `fkhr79/alexa-cookie#test/cumulative-auth-fixes-debug` as `alexa-cookie2` override

## Before you start

1. Open a terminal on the machine where Node-RED is installed.
2. Change into the Node-RED user directory.
3. Back up `package.json` and `package-lock.json`.
4. Install both debug packages.
5. Restart Node-RED.
6. Reproduce the login or refresh problem once.
7. Run the collector and share the generated bundle.
8. Restore the previous packages after the debug run.

Do not paste passwords, cookies, tokens, SMS codes, or full browser session data into an issue.

## Find the Node-RED user directory

Use the directory that contains your Node-RED `package.json`.

Common locations:

- Linux/macOS: `~/.node-red`
- Home Assistant / Docker containers: `/data`
- Windows: `%USERPROFILE%\.node-red`

If Node-RED runs in Docker, Home Assistant, Proxmox, or another Linux container, run the Linux commands inside that environment. Do not use the Windows commands for a Linux container just because the host machine is Windows.

## Install on Linux, macOS, Docker, or Home Assistant

Run this in the Node-RED user directory:

```sh
if [ -f package.json.auth-debug-backup ] || [ -f package-lock.json.auth-debug-backup ]; then
  echo "auth debug backup already exists; restore or move it before continuing"
  exit 1
fi
cp package.json package.json.auth-debug-backup
if [ -f package-lock.json ]; then cp package-lock.json package-lock.json.auth-debug-backup; fi
npm install --save \
  https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz \
  https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz
npm pkg set overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz
npm install
```

Restart Node-RED after the install command has finished.

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
if ((Test-Path package.json.auth-debug-backup) -or (Test-Path package-lock.json.auth-debug-backup)) {
  throw "auth debug backup already exists; restore or move it before continuing"
}
Copy-Item package.json package.json.auth-debug-backup
if (Test-Path package-lock.json) { Copy-Item package-lock.json package-lock.json.auth-debug-backup }
npm.cmd install --save `
  "https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz" `
  "https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz"
npm.cmd pkg set "overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz"
npm.cmd install
```

Restart Node-RED after the install command has finished.

If you start Node-RED manually from PowerShell, stop it with `Ctrl+C` and start it again.
If Node-RED runs as a Windows service, restart that service.

## Log location

The default debug log is based on Node.js `os.tmpdir()`:

```sh
node -e "const os=require('os'),path=require('path'); console.log(path.join(os.tmpdir(),'applestrudel-auth-debug','authdbg.jsonl'))"
```

Run this command inside the same environment that starts Node-RED. In many Linux containers this prints `/tmp/applestrudel-auth-debug/authdbg.jsonl`; on Windows it usually prints a path below `%TEMP%`.

The collector uses the same default path. You normally do not need to change it.

Only override the location if you know that the default temp directory is not suitable.

Linux/macOS/Docker/Home Assistant:

```sh
export APPLESTRUDEL_AUTH_DEBUG_DIR=/tmp/applestrudel-auth-debug
export APPLESTRUDEL_AUTH_DEBUG_LOG=/tmp/applestrudel-auth-debug/authdbg.jsonl
```

Windows PowerShell:

```powershell
$env:APPLESTRUDEL_AUTH_DEBUG_DIR="$env:TEMP\applestrudel-auth-debug"
$env:APPLESTRUDEL_AUTH_DEBUG_LOG="$env:TEMP\applestrudel-auth-debug\authdbg.jsonl"
```

Set these variables before starting Node-RED.

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

## Collect a sanitized bundle on Linux or macOS

After reproducing the issue, run this in the Node-RED user directory:

```sh
./node_modules/.bin/applestrudel-auth-debug-collect --out /tmp
```

## Collect a sanitized bundle in Docker or Home Assistant

Run the collector inside the Node-RED container or add-on shell, in the Node-RED user directory.

For many Node-RED containers and Home Assistant add-ons this directory is `/data`.

Collect to `/data` so the generated bundle is in the persistent Node-RED user directory:

```sh
cd /data
./node_modules/.bin/applestrudel-auth-debug-collect --out /data
```

If you use plain Docker from the host, copy the generated archive from the container after the collector has printed `tarFile=...`.

## Collect a sanitized bundle on Windows PowerShell

After reproducing the issue, run this in the Node-RED user directory:

```powershell
.\node_modules\.bin\applestrudel-auth-debug-collect.cmd --out "$env:TEMP"
```

The collector prints:

- `bundleDir=...`
- `tarFile=...` if a `.tar.gz` archive was created

On current Windows versions, `tarFile=...` should normally be printed. If no `tarFile=...` line appears, open the printed `bundleDir=...` folder and create a zip file from that folder manually.

## What to share in the issue

Share:

1. The generated `.tar.gz` or zip file.
2. Your operating system.
3. Your Node.js version from `node --version`.
4. Your Node-RED version.
5. Your Amazon region, for example `amazon.de`, `amazon.com`, or `amazon.co.uk`.
6. The login method you used, for example password only, app approval, SMS code, or 2FA app.
7. The final browser origin and path only. Remove the entire query string and fragment.
8. The visible browser message.

Check the generated files locally before sharing them. The collector masks known auth values again, but local paths and environment details can still be sensitive in some environments.

## Restore after the debug run

Restore the package files you backed up before installing the debug build.

Linux, macOS, Docker, or Home Assistant:

```sh
cp package.json.auth-debug-backup package.json
if [ -f package-lock.json.auth-debug-backup ]; then cp package-lock.json.auth-debug-backup package-lock.json; else rm -f package-lock.json; fi
npm install
rm -f package.json.auth-debug-backup package-lock.json.auth-debug-backup
```

Windows PowerShell:

```powershell
Copy-Item package.json.auth-debug-backup package.json
if (Test-Path package-lock.json.auth-debug-backup) {
  Copy-Item package-lock.json.auth-debug-backup package-lock.json
} elseif (Test-Path package-lock.json) {
  Remove-Item package-lock.json
}
npm.cmd install
Remove-Item package.json.auth-debug-backup
if (Test-Path package-lock.json.auth-debug-backup) { Remove-Item package-lock.json.auth-debug-backup }
```

Restart Node-RED again after restoring the previous package state.

# Auth Debug Test Build

This debug branch is intended for temporary auth and refresh diagnostics.

It combines:

- `fkhr79/node-red-contrib-alexa-remote2-applestrudel#test/cumulative-auth-fixes-debug`
- `fkhr79/alexa-cookie#test/cumulative-auth-fixes-debug` as `alexa-cookie2` override

## Before you start

1. Open a terminal on the machine where Node-RED is installed.
2. Change into the Node-RED user directory.
3. Install both debug packages.
4. Restart Node-RED.
5. Reproduce the login or refresh problem once.
6. Run the collector and share the generated bundle.

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

```powershell
npm install --save `
  "https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz" `
  "https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz"
npm pkg set "overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz"
npm install
```

Restart Node-RED after the install command has finished.

If you start Node-RED manually from PowerShell, stop it with `Ctrl+C` and start it again.
If Node-RED runs as a Windows service, restart that service.

## Log location

The default debug log on Linux, macOS, Docker, and Home Assistant is:

```sh
/tmp/applestrudel-auth-debug/authdbg.jsonl
```

The default debug log on Windows is:

```text
%TEMP%\applestrudel-auth-debug\authdbg.jsonl
```

You normally do not need to change this.

Only override the location if you know that the default temp directory is not suitable.

Linux/macOS:

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
4. Note the final browser URL.
5. Note the visible error message or success message.
6. Do not paste your password, cookies, tokens, or SMS code anywhere.

## Collect a sanitized bundle on Linux, macOS, Docker, or Home Assistant

After reproducing the issue, run this in the Node-RED user directory:

```sh
./node_modules/.bin/applestrudel-auth-debug-collect --out /tmp
```

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
7. The final browser URL, with account-specific IDs removed if visible.
8. The visible browser message.

Check the generated files locally before sharing them. The collector masks known auth values again, but local paths and environment details can still be sensitive in some environments.

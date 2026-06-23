# Auth Debug Test Build

This debug branch is intended for temporary auth and refresh diagnostics.

It combines:

- `fkhr79/node-red-contrib-alexa-remote2-applestrudel#test/cumulative-auth-fixes-debug`
- `fkhr79/alexa-cookie#test/cumulative-auth-fixes-debug` as `alexa-cookie2` override

## Install in a Node-RED user directory

Run these commands in the Node-RED user directory, usually `~/.node-red` or `/data`:

```sh
npm install --save \
  https://github.com/fkhr79/node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz \
  https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz
npm pkg set overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz
npm install
```

Restart Node-RED after installing.

## Log location

The default debug log is:

```sh
/tmp/applestrudel-auth-debug/authdbg.jsonl
```

Override the location before starting Node-RED if needed:

```sh
export APPLESTRUDEL_AUTH_DEBUG_DIR=/tmp/applestrudel-auth-debug
export APPLESTRUDEL_AUTH_DEBUG_LOG=/tmp/applestrudel-auth-debug/authdbg.jsonl
```

## Collect a sanitized bundle

After reproducing the login or refresh issue, run this in the Node-RED user directory:

```sh
./node_modules/.bin/applestrudel-auth-debug-collect --out /tmp
```

The collector prints `bundleDir=...` and, if `tar` is available, `tarFile=...`.

Share the generated bundle only after checking it locally. The collector masks known auth values again, but local paths and environment details can still be sensitive in some environments.

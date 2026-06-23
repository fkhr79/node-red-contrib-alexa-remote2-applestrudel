const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const alexaRemotePath = path.join(repoRoot, 'lib', 'alexa-remote-ext.js');
const accountNodePath = path.join(repoRoot, 'nodes', 'alexa-remote-account.js');

class FakeAlexaRemote extends EventEmitter {
	setMaxListeners(value) {
		super.setMaxListeners(value);
		return this;
	}

	resetExt() {}
}

function loadAccountNode() {
	delete require.cache[accountNodePath];
	require.cache[alexaRemotePath] = {
		id: alexaRemotePath,
		filename: alexaRemotePath,
		loaded: true,
		exports: FakeAlexaRemote,
	};

	let AccountNode;
	const RED = {
		nodes: {
			createNode(node) {
				const emitter = new EventEmitter();
				node.on = emitter.on.bind(emitter);
				node.emit = emitter.emit.bind(emitter);
				node.status = () => {};
				node.log = () => {};
				node.warn = () => {};
				node.error = () => {};
				node.debug = () => {};
				node.context = () => ({});
				node.credentials = {};
			},
			registerType(name, constructor) {
				if (name === 'alexa-remote-account') AccountNode = constructor;
			},
		},
		auth: {
			needsPermission: () => () => {},
		},
		httpAdmin: {
			get: () => {},
		},
	};

	require(accountNodePath)(RED);
	assert(AccountNode, 'Account node was not registered');
	return AccountNode;
}

function createAccount(env) {
	const previousDir = process.env.APPLESTRUDEL_AUTH_DEBUG_DIR;
	const previousLog = process.env.APPLESTRUDEL_AUTH_DEBUG_LOG;

	try {
		delete process.env.APPLESTRUDEL_AUTH_DEBUG_DIR;
		delete process.env.APPLESTRUDEL_AUTH_DEBUG_LOG;
		Object.assign(process.env, env);

		const AccountNode = loadAccountNode();
		return new AccountNode({
			refreshInterval: '',
			amazonPage: 'amazon.com',
		});
	}
	finally {
		if (previousDir === undefined) delete process.env.APPLESTRUDEL_AUTH_DEBUG_DIR;
		else process.env.APPLESTRUDEL_AUTH_DEBUG_DIR = previousDir;

		if (previousLog === undefined) delete process.env.APPLESTRUDEL_AUTH_DEBUG_LOG;
		else process.env.APPLESTRUDEL_AUTH_DEBUG_LOG = previousLog;
	}
}

function testAuthDebugFileLoggingIsOptIn() {
	const account = createAccount({});

	assert.strictEqual(account.authDebugEnabled, false);
	assert.strictEqual(account.authDebugLogDir, null);
	assert.strictEqual(account.authDebugLogFile, null);
}

function testDebugDirCanBeOverridden() {
	const customDir = path.join(os.tmpdir(), 'custom-applestrudel-auth-debug');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_DIR: customDir,
	});

	assert.strictEqual(account.authDebugLogDir, customDir);
	assert.strictEqual(account.authDebugLogFile, path.join(customDir, 'authdbg.jsonl'));
	assert.strictEqual(account.authDebugEnabled, true);
}

function testDebugLogCanBeOverridden() {
	const customLog = path.join(os.tmpdir(), 'custom-applestrudel-auth-debug-log', 'custom.jsonl');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_LOG: customLog,
	});

	assert.strictEqual(account.authDebugLogDir, path.dirname(customLog));
	assert.strictEqual(account.authDebugLogFile, customLog);
	assert.strictEqual(account.authDebugEnabled, true);
}

function testDebugLogOverrideDefinesWriteDirectory() {
	const customDir = path.join(os.tmpdir(), 'custom-applestrudel-auth-debug-dir');
	const customLog = path.join(os.tmpdir(), 'custom-applestrudel-auth-debug-log', 'custom.jsonl');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_DIR: customDir,
		APPLESTRUDEL_AUTH_DEBUG_LOG: customLog,
	});

	assert.strictEqual(account.authDebugLogDir, path.dirname(customLog));
	assert.strictEqual(account.authDebugLogFile, customLog);
	assert.strictEqual(account.authDebugEnabled, true);
}

function testAuthDebugWriteSanitizesFreeTextValues() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-write-test-'));
	const customLog = path.join(tempRoot, 'authdbg.jsonl');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_LOG: customLog,
	});

	account.authDebugWrite('test.freeText', {
		message: 'Cookie: session-id=secret-session; csrf=secret-csrf for secret-free-mail@example.invalid at C:\\Users\\secret-free-user\\auth\\cookie.json',
		pathMessage: 'C:\\Users\\secret-free-user\\auth\\cookie.json keep-safe-after-path',
		escapedPathMessage: 'C:\\\\Users\\\\secret-escaped-user\\\\auth\\\\cookie.json keep-safe-after-escaped-path',
		slashWindowsPathMessage: 'C:/Users/secret-slash-user/auth/cookie.json keep-safe-after-slash-windows-path',
		uncPathMessage: '\\\\secret-server\\secret-share\\auth\\cookie.json keep-safe-after-unc-path',
		spacedPathMessage: 'C:\\Users\\secret free user\\auth\\cookie.json keep-safe-after-spaced-path',
		posixPathMessage: '/home/secret-posix-user/auth/cookie.json keep-safe-after-posix-path',
		macPathMessage: '/Users/secret-mac-user/auth/cookie.json keep-safe-after-mac-path',
		dataPathMessage: '/data/secret-data-user/auth/cookie.json keep-safe-after-data-path',
		configPathMessage: '/config/secret-config-user/auth/cookie.json keep-safe-after-config-path',
		rootPathMessage: '/root/secret-root-user/.node-red/cookie.json keep-safe-after-root-path',
		dockerPathMessage: '/var/lib/docker/volumes/secret-docker-user/_data/auth/cookie.json keep-safe-after-docker-path',
		simplePosixPathMessage: '/tmp/fake-sensitive-token.jsonl keep-safe-after-simple-posix-path',
		dottedPosixPathMessage: '/opt/node-red/user_1/auth.debug/cookie-store_2026.jsonl keep-safe-after-dotted-posix-path',
		tmpPathMessage: '/tmp/applestrudel-auth-debug/secret-tmp-user/authdbg.jsonl keep-safe-after-tmp-path',
		varLibPathMessage: '/var/lib/node-red/secret-var-lib-user/auth/cookie.json keep-safe-after-var-lib-path',
		optPathMessage: '/opt/node-red/secret-opt-user/auth/cookie.json keep-safe-after-opt-path',
		mntPathMessage: '/mnt/data/supervisor/homeassistant/secret-mnt-user/auth/cookie.json keep-safe-after-mnt-path',
		haPathMessage: '/homeassistant/secret-ha-user/auth/cookie.json keep-safe-after-ha-path',
		urlPathMessage: 'GET /ap/static/file.json keep-safe-url-path',
		unknownCookieLine: 'Cookie: foo=secret-foo-cookie; bar=secret-bar-cookie keep-safe-after-cookie-line',
		prefixedJsonLine: 'AUTHDBG {"authorization":["Bearer secret-prefixed-bearer"],"safe":"visible-prefixed-json"}',
		nestedPrefixedJsonLine: 'AUTHDBG {"details":{"safe":"visible-nested-prefixed-json"},"authorization":["Bearer secret-prefixed-nested-bearer"],"cookie":{"localCookie":"secret-prefixed-nested-cookie"}}',
		callbackFields: {
			code: 'secret-json-code',
			state: 'secret-json-state',
		},
		shortUrl: 'https://example.invalid/callback?email=secret-short-url%40example.invalid&safe=visible-url-safe&note=secret-note-mail%40example.invalid',
		url: 'https://example.invalid/callback?access_token=secret-access&code=secret-code&state=secret-state&customerId=secret-customer-url&deviceSerialNumber=secret-device-url&email=secret-mail%40example.invalid&safe=visible-url-safe',
		openidUrl: 'https://example.invalid/maplanding?openid.claimed_id=secret-account&openid.identity=secret-identity&openid.sig=secret-openid-signature&openid.response_nonce=secret-nonce&serial=secret-serial',
		macDms: 'secret-macdms',
		cookieFile: 'C:\\Users\\secret-user\\auth\\cookie.json',
		email: 'secret-mail@example.invalid',
		customerId: 'secret-customer',
		serialNumber: 'secret-serial-number',
		deviceSerialNumber: 'secret-device-serial-number',
		applianceId: 'secret-appliance',
		entityId: 'secret-entity',
		safe: 'visible',
	});

	const log = fs.readFileSync(customLog, 'utf8');
	assert(!log.includes('secret-session'), 'session value leaked');
	assert(!log.includes('secret-csrf'), 'csrf value leaked');
	assert(!log.includes('secret-access'), 'access token leaked');
	assert(!log.includes('secret-code'), 'authorization code query leaked');
	assert(!log.includes('secret-state'), 'state query leaked');
	assert(!log.includes('secret-macdms'), 'macDms value leaked');
	assert(!log.includes('secret-account'), 'OpenID claimed id leaked');
	assert(!log.includes('secret-identity'), 'OpenID identity leaked');
	assert(!log.includes('secret-openid-signature'), 'OpenID signature leaked');
	assert(!log.includes('secret-nonce'), 'OpenID response nonce leaked');
	assert(!log.includes('secret-serial'), 'serial value leaked');
	assert(!log.includes('secret-user'), 'cookie file path leaked');
	assert(!log.includes('secret-free-user'), 'free text path leaked');
	assert(!log.includes('secret-escaped-user'), 'escaped free text path leaked');
	assert(!log.includes('secret-slash-user'), 'slash Windows free text path leaked');
	assert(!log.includes('secret-server'), 'UNC server leaked');
	assert(!log.includes('secret-share'), 'UNC share leaked');
	assert(!log.includes('secret free user'), 'free text path with spaces leaked');
	assert(!log.includes('secret-posix-user'), 'POSIX free text path leaked');
	assert(!log.includes('secret-mac-user'), 'macOS free text path leaked');
	assert(!log.includes('secret-data-user'), 'data directory free text path leaked');
	assert(!log.includes('secret-config-user'), 'config directory free text path leaked');
	assert(!log.includes('secret-root-user'), 'root directory free text path leaked');
	assert(!log.includes('secret-docker-user'), 'docker volume free text path leaked');
	assert(!log.includes('fake-sensitive-token'), 'simple POSIX free text path leaked');
	assert(!log.includes('user_1'), 'POSIX path segment with underscore leaked');
	assert(!log.includes('auth.debug'), 'POSIX path segment with dot leaked');
	assert(!log.includes('cookie-store_2026'), 'POSIX path file with hyphen and underscore leaked');
	assert(!log.includes('secret-tmp-user'), 'tmp free text path leaked');
	assert(!log.includes('secret-var-lib-user'), 'var lib free text path leaked');
	assert(!log.includes('secret-opt-user'), 'opt free text path leaked');
	assert(!log.includes('secret-mnt-user'), 'mnt data free text path leaked');
	assert(!log.includes('secret-ha-user'), 'homeassistant free text path leaked');
	assert(!log.includes('secret-foo-cookie'), 'unknown cookie value leaked');
	assert(!log.includes('secret-bar-cookie'), 'second unknown cookie value leaked');
	assert(!log.includes('secret-prefixed-bearer'), 'prefixed JSON authorization array leaked');
	assert(!log.includes('secret-prefixed-nested-bearer'), 'nested prefixed JSON authorization array leaked');
	assert(!log.includes('secret-prefixed-nested-cookie'), 'nested prefixed JSON cookie object leaked');
	assert(!log.includes('secret-mail'), 'email value leaked');
	assert(!log.includes('secret-short-url'), 'short URL email value leaked');
	assert(!log.includes('secret-note-mail'), 'URL-encoded email in non-sensitive query parameter leaked');
	assert(!log.includes('secret-free-mail'), 'free text email leaked');
	assert(!log.includes('secret-customer'), 'customer id leaked');
	assert(!log.includes('secret-device'), 'device id leaked');
	assert(!log.includes('secret-serial-number'), 'serial number leaked');
	assert(!log.includes('secret-appliance'), 'appliance id leaked');
	assert(!log.includes('secret-entity'), 'entity id leaked');
	assert(!log.includes('secret-json-code'), 'JSON code value leaked');
	assert(!log.includes('secret-json-state'), 'JSON state value leaked');
	assert(log.includes('visible'), 'safe value should remain visible');
	assert(log.includes('visible-url-safe'), 'safe URL query value should remain visible');
	assert(log.includes('keep-safe-after-path'), 'safe text after masked path should remain visible');
	assert(log.includes('keep-safe-after-escaped-path'), 'safe text after masked escaped path should remain visible');
	assert(log.includes('keep-safe-after-slash-windows-path'), 'safe text after masked slash Windows path should remain visible');
	assert(log.includes('keep-safe-after-unc-path'), 'safe text after masked UNC path should remain visible');
	assert(log.includes('keep-safe-after-spaced-path'), 'safe text after masked path with spaces should remain visible');
	assert(log.includes('keep-safe-after-posix-path'), 'safe text after masked POSIX path should remain visible');
	assert(log.includes('keep-safe-after-mac-path'), 'safe text after masked macOS path should remain visible');
	assert(log.includes('keep-safe-after-data-path'), 'safe text after masked data path should remain visible');
	assert(log.includes('keep-safe-after-config-path'), 'safe text after masked config path should remain visible');
	assert(log.includes('keep-safe-after-root-path'), 'safe text after masked root path should remain visible');
	assert(log.includes('keep-safe-after-docker-path'), 'safe text after masked docker path should remain visible');
	assert(log.includes('keep-safe-after-simple-posix-path'), 'safe text after masked simple POSIX path should remain visible');
	assert(log.includes('keep-safe-after-dotted-posix-path'), 'safe text after masked dotted POSIX path should remain visible');
	assert(log.includes('keep-safe-after-tmp-path'), 'safe text after masked tmp path should remain visible');
	assert(log.includes('keep-safe-after-var-lib-path'), 'safe text after masked var lib path should remain visible');
	assert(log.includes('keep-safe-after-opt-path'), 'safe text after masked opt path should remain visible');
	assert(log.includes('keep-safe-after-mnt-path'), 'safe text after masked mnt path should remain visible');
	assert(log.includes('keep-safe-after-ha-path'), 'safe text after masked homeassistant path should remain visible');
	assert(log.includes('/ap/static/file.json'), 'URL path should remain visible');
	assert(log.includes('keep-safe-url-path'), 'safe text after URL path should remain visible');
	assert(log.includes('keep-safe-after-cookie-line'), 'safe text after masked cookie line should remain visible');
	assert(log.includes('visible-prefixed-json'), 'safe prefixed JSON value should remain visible');
	assert(log.includes('visible-nested-prefixed-json'), 'safe nested prefixed JSON value should remain visible');
}

function testAuthDebugLoggerSanitizesNestedJsonValues() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-logger-test-'));
	const customLog = path.join(tempRoot, 'authdbg.jsonl');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_LOG: customLog,
	});

	account.authDebugLogger(JSON.stringify({
		headers: {
			authorization: ['Bearer nested-secret'],
			'set-cookie': ['session-id=nested-session; csrf=nested-csrf'],
		},
		safe: 'visible',
	}));

	const log = fs.readFileSync(customLog, 'utf8');
	assert(!log.includes('nested-secret'), 'nested authorization value leaked');
	assert(!log.includes('nested-session'), 'nested session value leaked');
	assert(!log.includes('nested-csrf'), 'nested csrf value leaked');
	assert(log.includes('visible'), 'safe value should remain visible');
}

testAuthDebugFileLoggingIsOptIn();
testDebugDirCanBeOverridden();
testDebugLogCanBeOverridden();
testDebugLogOverrideDefinesWriteDirectory();
testAuthDebugWriteSanitizesFreeTextValues();
testAuthDebugLoggerSanitizesNestedJsonValues();
console.log('auth-debug-path tests passed');

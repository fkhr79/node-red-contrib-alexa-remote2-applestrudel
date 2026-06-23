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
		url: 'https://example.invalid/callback?access_token=secret-access&code=secret-code&state=secret-state&customerId=secret-customer-url&deviceSerialNumber=secret-device-url&email=secret-mail%40example.invalid&safe=visible',
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
	assert(!log.includes('secret-mail'), 'email value leaked');
	assert(!log.includes('secret-free-mail'), 'free text email leaked');
	assert(!log.includes('secret-customer'), 'customer id leaked');
	assert(!log.includes('secret-device'), 'device id leaked');
	assert(!log.includes('secret-serial-number'), 'serial number leaked');
	assert(!log.includes('secret-appliance'), 'appliance id leaked');
	assert(!log.includes('secret-entity'), 'entity id leaked');
	assert(log.includes('visible'), 'safe value should remain visible');
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

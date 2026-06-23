const assert = require('assert');
const EventEmitter = require('events');
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

function testDefaultDebugPathIsGeneric() {
	const account = createAccount({});
	const expectedDir = path.join(os.tmpdir(), 'applestrudel-auth-debug');

	assert.strictEqual(account.authDebugLogDir, expectedDir);
	assert.strictEqual(account.authDebugLogFile, path.join(expectedDir, 'authdbg.jsonl'));
}

function testDebugDirCanBeOverridden() {
	const customDir = path.join(os.tmpdir(), 'custom-applestrudel-auth-debug');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_DIR: customDir,
	});

	assert.strictEqual(account.authDebugLogDir, customDir);
	assert.strictEqual(account.authDebugLogFile, path.join(customDir, 'authdbg.jsonl'));
}

function testDebugLogCanBeOverridden() {
	const customLog = path.join(os.tmpdir(), 'custom-applestrudel-auth-debug-log', 'custom.jsonl');
	const account = createAccount({
		APPLESTRUDEL_AUTH_DEBUG_LOG: customLog,
	});

	assert.strictEqual(account.authDebugLogDir, path.dirname(customLog));
	assert.strictEqual(account.authDebugLogFile, customLog);
}

testDefaultDebugPathIsGeneric();
testDebugDirCanBeOverridden();
testDebugLogCanBeOverridden();
console.log('auth-debug-path tests passed');

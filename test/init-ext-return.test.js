const assert = require('assert');
const EventEmitter = require('events');
const Module = require('module');

const expectedCookieData = {
	loginCookie: 'login-cookie',
	localCookie: 'local-cookie',
	csrf: 'csrf-token',
	refreshToken: 'refresh-token',
	dataVersion: 2,
};

class FakeAlexaRemote extends EventEmitter {
	constructor() {
		super();
	}
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
	if (request === 'alexa-remote2') {
		return FakeAlexaRemote;
	}
	if (request === 'tough-cookie') {
		return { CookieJar: class CookieJar {} };
	}
	return originalLoad.call(this, request, parent, isMain);
};

async function main() {
	try {
		const AlexaRemoteExt = require('../lib/alexa-remote-ext');

		const createAlexa = () => new AlexaRemoteExt({
			context: {
				global: {
					get: () => null,
					set: () => {},
				},
			},
		});

		const alexa = createAlexa();
		alexa.init = (config, callback) => {
			alexa.cookieData = expectedCookieData;
			callback(null);
		};
		alexa.checkAuthenticationExt = async () => true;
		alexa.updateExt = async () => {};

		const result = await alexa.initExt({});

		assert.strictEqual(result, expectedCookieData);

		const alexaWithoutCookieData = createAlexa();
		alexaWithoutCookieData.init = (config, callback) => callback(null);
		alexaWithoutCookieData.checkAuthenticationExt = async () => true;
		alexaWithoutCookieData.updateExt = async () => {};

		const resultWithoutCookieData = await alexaWithoutCookieData.initExt({});

		assert.strictEqual(resultWithoutCookieData, null);

		const alexaWithLogger = createAlexa();
		const logs = [];
		alexaWithLogger.init = (_config, callback) => callback(null);
		alexaWithLogger.checkAuthenticationExt = async () => true;
		alexaWithLogger.updateExt = async () => {};

		await alexaWithLogger.initExt({
			amazonPage: 'https://example.invalid/?openid.sig=secret-openid-signature&openid.claimed_id=secret-account&serial=secret-serial&code=secret-code&state=secret-state&access_token=secret-access',
			logger: line => logs.push(line),
		});

		const joined = logs.join('\n');
		assert(!joined.includes('secret-access'), 'access token leaked through auth debug logger');
		assert(!joined.includes('secret-openid-signature'), 'OpenID signature leaked through auth debug logger');
		assert(!joined.includes('secret-account'), 'OpenID claimed id leaked through auth debug logger');
		assert(!joined.includes('secret-serial'), 'serial value leaked through auth debug logger');
		assert(!joined.includes('secret-code'), 'authorization code query leaked through auth debug logger');
		assert(!joined.includes('secret-state'), 'state query leaked through auth debug logger');
		assert(joined.includes('[AUTHDBG_FIELD_MASKED]'), 'masked marker missing');

		const alexaWithNestedLogger = createAlexa();
		const nestedLogs = [];
		alexaWithNestedLogger.init = (_config, callback) => callback(null);
		alexaWithNestedLogger.checkAuthenticationExt = async () => true;
		alexaWithNestedLogger.updateExt = async () => {};

		await alexaWithNestedLogger.initExt({
			amazonPage: JSON.stringify({
				headers: {
					authorization: ['Bearer nested-secret'],
				},
			}),
			logger: line => nestedLogs.push(line),
		});

		const joinedNested = nestedLogs.join('\n');
		assert(!joinedNested.includes('nested-secret'), 'nested authorization value leaked through auth debug logger');
	}
	finally {
		Module._load = originalLoad;
	}
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});

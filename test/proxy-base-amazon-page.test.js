const assert = require('assert');
const Module = require('module');

class FakeAlexaRemote {
	constructor(options = {}) {
		this._options = options;
	}
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
	if (request === 'alexa-remote2') return FakeAlexaRemote;
	if (request === 'tough-cookie') return { CookieJar: class CookieJar {} };
	if (request === './auth/auth-controller') {
		return { AlexaAuthController: class AlexaAuthController {} };
	}
	if (request === './auth/token-store') {
		return { TokenStore: class TokenStore {} };
	}
	if (request === './auth/oauth-device') {
		return { OAuthDevice: class OAuthDevice {} };
	}
	return originalLoad.call(this, request, parent, isMain);
};

const AlexaRemoteExt = require('../lib/alexa-remote-ext.js');
Module._load = originalLoad;

async function callGenerateCookie(alexa) {
	return new Promise((resolve, reject) => {
		alexa.generateCookie('user@example.invalid', 'password', err => err ? reject(err) : resolve());
	});
}

async function testLeavesProxyBaseAmazonPageUnsetByDefault() {
	const alexa = new AlexaRemoteExt({
		amazonPage: 'amazon.de',
		context: { global: {} },
	});
	let cookieOptions;

	alexa.alexaCookie = {
		generateAlexaCookie: (_email, _password, options, callback) => {
			cookieOptions = options;
			callback(null, 'cookie');
		},
	};

	await callGenerateCookie(alexa);

	assert.strictEqual(cookieOptions.amazonPage, 'amazon.de');
	assert.strictEqual(cookieOptions.baseAmazonPage, undefined);
}

async function testKeepsExplicitProxyBaseAmazonPage() {
	const alexa = new AlexaRemoteExt({
		amazonPage: 'amazon.de',
		baseAmazonPage: 'amazon.com',
		context: { global: {} },
	});
	let cookieOptions;

	alexa.alexaCookie = {
		generateAlexaCookie: (_email, _password, options, callback) => {
			cookieOptions = options;
			callback(null, 'cookie');
		},
	};

	await callGenerateCookie(alexa);

	assert.strictEqual(cookieOptions.amazonPage, 'amazon.de');
	assert.strictEqual(cookieOptions.baseAmazonPage, 'amazon.com');
}

Promise.resolve()
	.then(testLeavesProxyBaseAmazonPageUnsetByDefault)
	.then(testKeepsExplicitProxyBaseAmazonPage)
	.then(() => {
		console.log('proxy-base-amazon-page tests passed');
	})
	.catch(error => {
		console.error(error);
		process.exitCode = 1;
	});

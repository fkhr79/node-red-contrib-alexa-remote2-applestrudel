const AlexaRemote = require('alexa-remote2');
const tough = require('tough-cookie');
const tools = require('./common.js');
const known = require('./known-color-values.js');
const convert = require('./color-convert.js');
const deltaE = require('./delta-e.js');
const DEBUG_THIS = tools.DEBUG_THIS;
const REQUEST_RATE_LIMIT_EXPIRATION_IN_M = 5;

function requireUncached(mod) {
	delete require.cache[require.resolve(mod)];
	return require(mod);
}

function isAuthError(err) {
	if (!err) return false;
	const code = Number(err.statusCode || err.code);
	if (code === 401 || code === 403) return true;
	const message = String(err.message || '').toLowerCase();
	return message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden');
}

function getHeader(headers, name) {
	if (!headers) return undefined;
	const lowerName = name.toLowerCase();
	const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === lowerName);
	return key ? headers[key] : undefined;
}

function normalizeSetCookieHeaders(setCookie) {
	if (!setCookie) return [];
	return (Array.isArray(setCookie) ? setCookie : [setCookie])
		.map(cookie => String(cookie || '').split(';')[0].trim())
		.filter(Boolean);
}

function mergeCookieStrings(existingCookie, setCookie) {
	const cookieMap = new Map();
	const addCookie = cookie => {
		const separator = cookie.indexOf('=');
		if (separator <= 0) return;
		cookieMap.set(cookie.slice(0, separator).trim(), cookie.trim());
	};

	String(existingCookie || '').split(';').map(cookie => cookie.trim()).filter(Boolean).forEach(addCookie);
	normalizeSetCookieHeaders(setCookie).forEach(addCookie);
	return Array.from(cookieMap.values()).join('; ');
}

function authDebugSensitiveKey(key) {
	const text = String(key || '');
	return /(loginCookie|localCookie|^cookie$|Cookie$|set-cookie|token|access_token|refresh_token|source_token|authorization|openid(?:\.|_|$)|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|^serial$|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session|^code$|^state$)/i.test(text);
}

function authDebugMaskJsonValue(value, key = '') {
	if (authDebugSensitiveKey(key)) return '[AUTHDBG_MASKED]';
	if (Array.isArray(value)) return value.map(item => authDebugMaskJsonValue(item));
	if (value && typeof value === 'object') {
		const masked = {};
		for (const childKey of Object.keys(value)) masked[childKey] = authDebugMaskJsonValue(value[childKey], childKey);
		return masked;
	}
	if (typeof value === 'string') return authDebugSanitizeText(value);
	return value;
}

function authDebugSanitizeJsonLine(line) {
	try {
		return JSON.stringify(authDebugMaskJsonValue(JSON.parse(line)));
	}
	catch (_err) {
		return null;
	}
}

function authDebugSanitizeJsonFragments(value) {
	return String(value).replace(/\{[^{}\n\r]*\}/g, fragment => authDebugSanitizeJsonLine(fragment) || fragment);
}

function authDebugSanitizeCookieHeader(value) {
	return String(value).replace(/\b(Cookie\s*:\s*)([^\n\r]+)/gi, (_match, prefix, cookieText) =>
		prefix + cookieText.replace(/([^=;\s]+)=([^;\s\n\r]+)/g, '$1=[AUTHDBG_MASKED]')
	);
}

function authDebugSanitizeText(value) {
	return authDebugSanitizeCookieHeader(
		authDebugSanitizeJsonFragments(
			String(value).split(/\r?\n/).map(line => authDebugSanitizeJsonLine(line) || line).join('\n')
		)
	)
		.replace(/("(?:loginCookie|localCookie|cookie|Cookie|set-cookie|authorization|openid(?:\.[A-Za-z0-9_.-]+)?|authorization_code|code|state|accessToken|refreshToken|access_token|refresh_token|source_token|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|serial|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)"\s*:\s*)"([^"\\]|\\.)*"/gi, '$1"[AUTHDBG_MASKED]"')
		.replace(/((?:loginCookie|localCookie|Cookie|set-cookie|authorization|openid(?:\.[A-Za-z0-9_.-]+)?|authorization_code|code|state|accessToken|refreshToken|access_token|refresh_token|source_token|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|serial|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)\s*[:=]\s*)([^&"'\n\r,;}]+)/gi, '$1[AUTHDBG_MASKED]')
		.replace(/\b(?:authorization_code|openid\.[A-Za-z0-9_.-]+|access_token|refresh_token|source_token|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|serial|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)=([^;,&\s"'}]+)/gi, '[AUTHDBG_FIELD_MASKED]')
		.replace(/\b((?:session-id(?:-time)?|session-token|csm-hit|ubid-[A-Za-z0-9-]+|x-[A-Za-z0-9-]+|at-[A-Za-z0-9-]+|sess-at-[A-Za-z0-9-]+|lc-[A-Za-z0-9-]+|i18n-prefs))=([^;,&\s"'}]+)/gi, '$1=[AUTHDBG_MASKED]')
		.replace(/\b(Atza\|)[A-Za-z0-9._~+/=-]+/g, '$1[AUTHDBG_MASKED]')
		.replace(/\b(X-Amz-[A-Za-z0-9-]+)=([^;,&\s"'}]+)/gi, '$1=[AUTHDBG_MASKED]')
		.replace(/\b(?:code|state)=([^;,&\s"'}]+)/gi, '[AUTHDBG_FIELD_MASKED]')
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[AUTHDBG_EMAIL_MASKED]')
		.replace(/\b[A-Z0-9._%+-]+%40[A-Z0-9.-]+(?:\.[A-Z]{2,}|%2E[A-Z]{2,})\b/gi, '[AUTHDBG_EMAIL_MASKED]')
		.replace(/\b[A-Za-z]:\\+(?:[^\\/"'\n\r,;}]+\\+)*(?:[^\\/"'\n\r,;}]*?\.[A-Za-z0-9]{1,12}|[^\\/"'\s\n\r,;}]+)/g, '[AUTHDBG_PATH_MASKED]')
		.replace(/\b[A-Za-z]:\/+(?:[^\/\\"'\n\r,;}]+\/+)*(?:[^\/\\"'\n\r,;}]*?\.[A-Za-z0-9]{1,12}|[^\/\\"'\s\n\r,;}]+)/g, '[AUTHDBG_PATH_MASKED]')
		.replace(/\\{2,}(?:[^\\/"'\n\r,;}]+\\+)+(?:[^\\/"'\n\r,;}]*?\.[A-Za-z0-9]{1,12}|[^\\/"'\s\n\r,;}]+)/g, '[AUTHDBG_PATH_MASKED]')
		.replace(/(?:\/home\/|\/Users\/|\/data\/|\/config\/|\/root\/|\/var\/lib\/docker\/volumes\/|\/mnt\/data\/|\/homeassistant\/)(?:[^\/"'\n\r,;}]+\/)*(?:[^\/"'\n\r,;}]*?\.[A-Za-z0-9]{1,12}|[^\/"'\s\n\r,;}]+)/g, '[AUTHDBG_PATH_MASKED]');
}

function authDebugShape(value, depth = 0, key = '') {
	if (value === undefined) return { type: 'undefined', present: false };
	if (value === null) return { type: 'null', present: false };
	if (authDebugSensitiveKey(key)) {
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		return { type: typeof value, present: !!value, length: text ? text.length : 0 };
	}
	if (typeof value === 'string') {
		const sanitized = authDebugSanitizeText(value);
		return { type: 'string', present: sanitized.length > 0, length: sanitized.length, value: sanitized.length <= 160 ? sanitized : sanitized.slice(0, 160) };
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return { type: 'array', length: value.length, sample: depth < 1 ? value.slice(0, 6).map(v => authDebugShape(v, depth + 1)) : undefined };
	if (typeof value === 'object') {
		const keys = Object.keys(value).sort();
		const shaped = { type: 'object', keys };
		if (depth < 2) {
			shaped.values = {};
			for (const childKey of keys) shaped.values[childKey] = authDebugShape(value[childKey], depth + 1, childKey);
		}
		return shaped;
	}
	return { type: typeof value, value: String(value) };
}

function authDebugToLogger(logger, event, details = {}) {
	try {
		if (logger) logger('AUTHDBG ' + JSON.stringify({ component: 'alexa-remote-ext', event, details: authDebugShape(details) }));
	} catch (_err) {
		// observation must never change auth flow
	}
}

// my own implementation to keep track of the value on errors, for debugging
function promisify(fun) {
	return (function () {
		const args = Array.from(arguments);
		const call = () => new Promise((resolve, reject) => {
			fun.bind(this)(...args, (err, val) => {
				if (err) {
					if (typeof err === 'object') {
						err.value = val;
					}
					reject(err);
				}
				else {
					resolve(val);
				}
			});
		});

		return call().catch(async error => {
			if (!isAuthError(error) || typeof this.refreshAlexaCookies !== 'function') {
				throw error;
			}

			try {
				await this.refreshAlexaCookies();
			}
			catch (refreshError) {
				throw refreshError;
			}

			return call();
		});
	});
}
function stringForCompare(str) {
	return String(str).replace(/[^a-z0-9]/ig, '').toLowerCase();
}

function ensureMatch(response, template) {
	if (!tools.matches(response, template)) throw new Error(`unexpected response: "${JSON.stringify(response)}"`);
}

function isHexColor(str) {
	if (str.startsWith('#')) str = str.slice(1);
	if (str.length !== 6) return false;
	for (const c of str) if (Number.isNaN(parseInt(c, 16))) return false;
	return true;
}

class AlexaRemoteExt extends AlexaRemote {
	constructor(options = {}) {
		super(options);
		this.context = options.context; // Node-RED global
		this.options = options;

		this.cookieJar = new tough.CookieJar();

		const { AlexaAuthController } = require('./auth/auth-controller');
		const { TokenStore } = require('./auth/token-store');
		const { OAuthDevice } = require('./auth/oauth-device');

		this.tokenStore = new TokenStore(this.context.global);
		this.oauth = new OAuthDevice(options);
		this.auth = new AlexaAuthController(this.tokenStore, this.oauth);
		this.loggedIn = false;

		// blacklist: ^(?:\t|[ ]{4})(?![A-z]*constructor)[A-z]*\((?![^\)]*callback)[^\)]*\)
		const names = [
			// smarthome
			'getSmarthomeDevices',
			'getSmarthomeEntities',
			'getSmarthomeGroups',
			'getSmarthomeBehaviourActionDefinitions',
			'discoverSmarthomeDevice',
			'deleteAllSmarthomeDevices',
			// echo
			'getDevices',
			'getMedia',
			'getPlayerInfo',
			'getDeviceNotificationState',
			'getDevicePreferences',
			'getDeviceStatusList',
			'getNotifications',
			'getBluetooth',
			'getWakeWords',
			'renameDevice',
			'deleteDevice',
			'setTunein',
			'setDoNotDisturb',
			'setAlarmVolume',
			'getDoNotDisturb',
			'sendCommand',
			// other
			'getAccount',
			'getContacts',
			'getConversations',
			'getAutomationRoutines',
			'getMusicProviders',
			'getActivities',
			'getCustomerHistoryRecords',
			'getHomeGroup',
			'getCards',
			'sendTextMessage',
			'deleteConversation',

			// 'connectBluetooth',
			// 'unpaireBluetooth',
			// 'disconnectBluetooth',

			'getListsV2',
			'getList',
			'getListItems',
			'addListItem',
			'updateListItem',
			'deleteListItem'
		];

		for (const name of names) {
			if (typeof this[name] === 'function') {
				this[name + 'Promise'] = promisify(this[name]);
			}
		}

		this.errorMessagesExt = {};
		this.smarthomeSimplifiedByEntityIdExt = new Map();
		this.smarthomeRequestsRateLimit = new Map();
		this.routineByIdExt = new Map();
		this.routineByUtteranceExt = new Map();
		this.musicProvidersExt = [];
		this.deviceByIdExt = new Map();
		this.deviceByNameExt = new Map();
		this.bluetoothStateByIdExt = new Map();
		this.wakeWordByIdExt = new Map();
		this.notificationByIdExt = new Map();
		this.notificationByNameExt = new Map();
		this.notificationUpdatesExt = [];
		this.notificationUpdatesRunning = false;

		this.colorNamesExt = new Set();
		this.colorNameToLabelExt = new Map();
		this.compareToColorNameExt = new Map();
		this.colorNameToHexExt = new Map();

		this.colorTemperatureNamesExt = new Set();
		this.colorTemperatureNameToLabelExt = new Map();
		this.compareToColorTemperatureNameExt = new Map();
		this.colorTemperatureNameToKelvinExt = new Map();

		this.logWarn = () => { };
	}

	_rateLimitRequestHasExpired(date) {
		const expirationDate = Date.now() - REQUEST_RATE_LIMIT_EXPIRATION_IN_M * 60 * 1000;

		if (expirationDate > date) {
			return true;
		} else {
			return false;
		}
	}

	_requestRateLimitCheck(key) {
	    if (this.smarthomeRequestsRateLimit.has(key)) {
            if (this._rateLimitRequestHasExpired(this.smarthomeRequestsRateLimit.get(key))) {
                this.smarthomeRequestsRateLimit.set(key, Date.now());
            } else {
                throw new Error('Too many request. Try again in ' + REQUEST_RATE_LIMIT_EXPIRATION_IN_M + ' minutes.');
            }
	    } else {
	        this.smarthomeRequestsRateLimit.set(key, Date.now());
	    }
	}

	async initExt(config, proxyActiveCallback = () => { }, logWarn = () => { }, logError = () => { }) {
		this.logWarn = logWarn;
		this.logError = logError;
		authDebugToLogger(config && config.logger, 'initExt.start', {
			amazonPage: config && config.amazonPage,
			baseAmazonPage: config && config.baseAmazonPage,
			proxyOwnIp: config && config.proxyOwnIp,
			proxyPort: config && config.proxyPort,
			proxyOnly: config && config.proxyOnly,
			setupProxy: config && config.setupProxy,
			cookie: config && config.cookie
		});

		const value = await new Promise((resolve, reject) => this.init(config, (err, val) => {
			if (err) {
				// proxy status message is not the final callback call
				// it is also not an actual error
				// so we filter it out and report it our own way
				const bypassError1 = /^You can try to get the cookie manually by opening https?:\/\/(.*)\/ with your browser\.$/;
				const bypassError2 = /^Please open https?:\/\/(.*)\/ with your browser and login to Amazon\. The cookie will be output here after successfull login\.$/;
				const matchError1 = bypassError1.exec(err.message);
				const matchError2 = bypassError2.exec(err.message);

				if (matchError1 || matchError2) {
					// const url = matchError1 && matchError1[1] || matchError2 && matchError2[1];
					const url = `http://${config.proxyOwnIp}:${config.proxyPort}`;
					authDebugToLogger(config && config.logger, 'initExt.proxyActive', { url });
					proxyActiveCallback(url);
				} else {
					authDebugToLogger(config && config.logger, 'initExt.init.error', { message: err && err.message, code: err && err.code, statusCode: err && err.statusCode });
					reject(err);
				}
			}
			else {
				authDebugToLogger(config && config.logger, 'initExt.init.callback.success', { value: val });
				resolve(null);
			}
		}));

		authDebugToLogger(config && config.logger, 'initExt.checkAuthentication.start', { hasCookieData: !!this.cookieData, hasCookie: !!this.cookie, hasCsrf: !!this.csrf });
		await this.checkAuthenticationExt().then(authenticated => {
			authDebugToLogger(config && config.logger, 'initExt.checkAuthentication.result', { authenticated });
			if (!authenticated) throw new Error('Authentication unsuccessful');
		}).catch(error => {
			authDebugToLogger(config && config.logger, 'initExt.checkAuthentication.error', { message: error && error.message, code: error && error.code, statusCode: error && error.statusCode });
			error.message = `Authentication failed: "${error.message}"`;
			throw error;
		});

		authDebugToLogger(config && config.logger, 'initExt.update.start', {});
		await this.updateExt();
		authDebugToLogger(config && config.logger, 'initExt.update.done', { cookieData: this.cookieData });

		this.on('ws-notification-change', payload => {
			this.updateNotificationsExt(payload.eventType, payload.notificationId, String(payload.notificationVersion));
		});
		
		authDebugToLogger(config && config.logger, 'initExt.return', { cookieData: this.cookieData, fallbackValue: value });
		return this.cookieData || value;
	}
    
	checkAuthentication(callback) {
		return super.checkAuthentication(callback);
	}

	async refreshAlexaCookies() {
		const primaryOptions = this.options || {};
		const legacyOptions = this._options || {};
		const authLogger = primaryOptions.logger || legacyOptions.logger;
		authDebugToLogger(authLogger, 'refresh.start', { primaryCookie: primaryOptions.cookie, legacyCookie: legacyOptions.cookie, cookieData: this.cookieData });
		const getTokenRegistrationData = data => tools.isObject(data) && data.loginCookie && data.refreshToken
			? data
			: undefined;
		const tokenRegistrationData = getTokenRegistrationData(primaryOptions.formerRegistrationData)
			|| getTokenRegistrationData(legacyOptions.formerRegistrationData)
			|| getTokenRegistrationData(primaryOptions.cookie)
			|| getTokenRegistrationData(legacyOptions.cookie)
			|| getTokenRegistrationData(this.cookieData);
		const existingStructuredCookieData = tokenRegistrationData
			|| [primaryOptions.cookie, legacyOptions.cookie, this.cookieData]
				.find(cookieData => tools.isObject(cookieData));

		// Prefer alexa-remote2's native refresh flow when we have saved proxy auth data.
		if (tokenRegistrationData) {
			authDebugToLogger(authLogger, 'refresh.tokenPath.start', { tokenRegistrationData });
			try {
				legacyOptions.formerRegistrationData = tokenRegistrationData;
				const refreshed = await new Promise((resolve, reject) => {
					if (!this.alexaCookie)
						this.alexaCookie = requireUncached('alexa-cookie2');
					this.alexaCookie.refreshAlexaCookie(legacyOptions, (err, result) => err ? reject(err) : resolve(result));
				});

				const refreshedCookieData = refreshed || this.cookieData || tokenRegistrationData;
				primaryOptions.cookie = refreshedCookieData;
				legacyOptions.cookie = refreshedCookieData;
				primaryOptions.formerRegistrationData = refreshedCookieData;
				legacyOptions.formerRegistrationData = refreshedCookieData;
				this.setCookie(refreshedCookieData);
				authDebugToLogger(authLogger, 'refresh.tokenPath.result', { refreshedCookieData, hasCookie: !!this.cookie, hasCsrf: !!this.csrf });

				if (this.cookie && this.csrf) {
					primaryOptions.headers = primaryOptions.headers || {};
					primaryOptions.headers.Cookie = this.cookie;
					primaryOptions.headers['csrf'] = this.csrf;

					legacyOptions.headers = legacyOptions.headers || {};
					legacyOptions.headers.Cookie = this.cookie;
					legacyOptions.headers['csrf'] = this.csrf;
					return;
				}
			} catch (_e) {
				authDebugToLogger(authLogger, 'refresh.tokenPath.error', { message: _e && _e.message, code: _e && _e.code, statusCode: _e && _e.statusCode });
				// Token refresh failed — fall through to SPA refresh below.
			}
		}

		const normalizeAmazonPage = value => String(value || '')
			.replace(/^https?:\/\//, '')
			.replace(/^alexa\./, '')
			.replace(/\/.*$/, '');
		const normalizeHost = value => String(value || '')
			.replace(/^https?:\/\//, '')
			.replace(/\/.*$/, '');
		const amazonPage = normalizeAmazonPage(primaryOptions.amazonPage || legacyOptions.amazonPage);
		const alexaServiceHost = normalizeHost(primaryOptions.alexaServiceHost || legacyOptions.alexaServiceHost || primaryOptions.baseUrl || legacyOptions.baseUrl || this.baseUrl);
		const spaHost = amazonPage ? `alexa.${amazonPage}` : alexaServiceHost;
		authDebugToLogger(authLogger, 'refresh.spaPath.start', { amazonPage, alexaServiceHost, spaHost });
		if (!spaHost) {
			throw new Error('Missing amazonPage/alexaServiceHost for Alexa SPA URL (both options and _options are empty)');
		}

		const existingCookie = this.cookie
			|| (existingStructuredCookieData && existingStructuredCookieData.localCookie)
			|| getHeader(primaryOptions.headers, 'Cookie')
			|| getHeader(legacyOptions.headers, 'Cookie');
		const spaHeaders = {
			'User-Agent': primaryOptions.userAgent || legacyOptions.userAgent,
			'Accept-Language': primaryOptions.acceptLanguage || legacyOptions.acceptLanguage || 'de-DE'
		};
		if (existingCookie) {
			spaHeaders.Cookie = existingCookie;
		}

		const res = await this.auth.request({
			method: 'GET',
			url: `https://${spaHost}/spa/index.html`,
			headers: spaHeaders,
			followRedirect: true
		});

    	if (!res || !res.headers) {
        	throw new Error('No response headers from Alexa SPA');
    	}

    	const setCookie = res.headers['set-cookie'];
    	if (!setCookie) {
        	throw new Error('No Alexa cookies received');
    	}

		const responseCookie = normalizeSetCookieHeaders(setCookie).join('; ');
		const refreshedCsrf = this._extractCsrf(responseCookie);
		if (!refreshedCsrf) {
			throw new Error('Alexa SPA cookies did not include csrf');
		}
		const refreshedCookie = mergeCookieStrings(existingCookie, setCookie);

		this.cookie = refreshedCookie;
		this.csrf = refreshedCsrf;

		if (this.csrf && existingStructuredCookieData) {
			const refreshedCookieData = Object.assign({}, existingStructuredCookieData, {
				localCookie: this.cookie,
				csrf: this.csrf
			});
			this.cookieData = refreshedCookieData;
			primaryOptions.cookie = refreshedCookieData;
			legacyOptions.cookie = refreshedCookieData;
			primaryOptions.formerRegistrationData = refreshedCookieData;
			legacyOptions.formerRegistrationData = refreshedCookieData;

			if (this.csrf) {
				this.macDms = legacyOptions.macDms = legacyOptions.macDms || refreshedCookieData.macDms;
				this.emit('cookie', this.cookie, this.csrf, this.macDms);
			}
		}

    	primaryOptions.headers = primaryOptions.headers || {};
    	primaryOptions.headers.Cookie = this.cookie;
    	primaryOptions.headers['csrf'] = this.csrf;

    	legacyOptions.headers = legacyOptions.headers || {};
    	legacyOptions.headers.Cookie = this.cookie;
    	legacyOptions.headers['csrf'] = this.csrf;
		authDebugToLogger(authLogger, 'refresh.spaPath.done', { cookieData: this.cookieData, hasCookie: !!this.cookie, hasCsrf: !!this.csrf });
	}

	_extractCsrf(cookie) {
    	const match = cookie.match(/csrf=([^;]+)/);
    	return match ? match[1] : null;
	}
	async updateExt() {
		const handleNonCritical = (promise, prop, label) => promise
			.then(() => {
				this.errorMessagesExt[prop] = null;
			})
			.catch(error => {
				error.message = `failed to load ${label || prop}: "${error.message}"`;
				this.errorMessagesExt[prop] = error.message;
				this.logWarn(error);
			});


		const initPromises = [
			this.initAccountExt(),
			this.initDevicesExt(),
			handleNonCritical(this.initNotificationsExt(), 'notifications'),
			handleNonCritical(this.initRoutinesExt(), 'routines'),
			handleNonCritical(this.initMusicProvidersExt(), 'musicProviders', 'music providers'),
		];

		// needs to happen before initSmarthomeColors because it accesses smarthome devices
		await handleNonCritical(this.initSmarthomeSimplifiedExt(), 'smarthome', 'smarthome devices');

		await Promise.all(initPromises.concat([
			handleNonCritical(this.initSmarthomeColorsExt(), 'colors', 'smarthome colors')
		]));

		//get customer id of logged in user
		this.ownerCustomerId = await this.getCustomerId();
		//tools.log({id:this.ownerCustomerId});
	}

	async initSmarthomeSimplifiedExt() {
		//throw new Error('TESTING');
		const [groups, entityByEntityId, deviceByApplianceId] = await Promise.all([
			this.getSmarthomeGroupsPromise().then(response => response.applianceGroups),
			this.getSmarthomeEntitiesPromise().then(entities => {
				if (!Array.isArray(entities)) {
					throw new Error(JSON.stringify(entities));
				}
				return new Map(entities.map(o => [o.id, o]));
			}),
			this.getSmarthomeDevicesPromise().then(response => {
				// Array.prototype.flat only supported since 11
				//tools.log({response:response}, 1);
				const locations = Object.values(response.locationDetails);
				//tools.log({locations:locations}, 1);
				const bridges = tools.flat(locations.map(o => Object.values(o.amazonBridgeDetails.amazonBridgeDetails)));
				//tools.log({bridges:bridges}, 1);
				const devices = tools.flat(bridges.map(o => Object.values(o.applianceDetails.applianceDetails)));
				//tools.log({devices:devices}, 0);
				return new Map(devices.map(o => [o.applianceId, o]));
			})
		]);

		this.smarthomeSimplifiedByEntityIdExt = new Map();
		for (const device of deviceByApplianceId.values()) {
			const properties = [];

			if (device.capabilities) {
				for (const capability of device.capabilities) {
					if (!capability.properties || !capability.properties.supported) continue;
					for (const property of capability.properties.supported) {
						properties.push(property.name);
					}
				}
			}


			const entity = entityByEntityId.get(device.entityId) || {};

			let isDuplicate = false;

			try {
				if (entity.providerData.relationships.find(x => x.type === 'isDuplicateOf')) {
					isDuplicate = true;
				}
			}
			catch (ex) {
			}

			// supportedOperations is enough? we don't care about unsupported operations anyway
			//
			// const uniqueActions = new Set();
			// for(const action of device.actions) {
			// 	uniqueActions.add(action);
			// }
			// for(const action of entity.supportedOperations || []) {
			// 	uniqueActions.add(action);
			// }
			// for(const action of entity.supportedProperties || []) {
			// 	uniqueActions.add(action);
			// }

			if (device.applianceTypes[0] === 'OTHER' && device.manufacturerName === 'AMAZON' && device.driverIdentity && device.driverIdentity.namespace === 'AAA') {
				// this is probably an Echo
				device.applianceTypes[0] = 'ECHO';
			}

			// common
			const entry = {};
			entry.entityId = device.entityId;
			entry.applianceId = device.applianceId;
			entry.name = device.friendlyName;
			entry.type = 'APPLIANCE';
			entry.actions = entity.supportedOperations || [];
			entry.properties = properties;
			entry.applianceTypes = device.applianceTypes;
			entry.isDuplicate = isDuplicate;
			// entry.actions = Array.from(uniqueActions);

			this.smarthomeSimplifiedByEntityIdExt.set(entry.entityId, entry);
		}
		for (const group of groups) {

			const entry = {};

			// group specific
			const applianceIds = group.applianceIds || [];
			const entityIds = applianceIds.map(id => deviceByApplianceId.get(id)).filter(o => o).map(o => o.entityId);
			entry.children = entityIds.map(id => this.smarthomeSimplifiedByEntityIdExt.get(id)).filter(x => x);

			const uniqueActions = new Set();
			const uniqueProperties = new Set();
			const uniqueTypes = new Set();
			for (const entity of entry.children) {
				for (const action of entity.actions) uniqueActions.add(action);
				for (const property of entity.properties) uniqueProperties.add(property);
				for (const type of entity.applianceTypes) uniqueTypes.add(type);
			}

			// common
			entry.groupId = group.groupId;
			entry.entityId = group.groupId.substr(group.groupId.lastIndexOf('.') + 1);
			entry.name = group.name;
			entry.type = 'GROUP';
			entry.actions = Array.from(uniqueActions);
			entry.properties = Array.from(uniqueProperties);
			entry.applianceTypes = Array.from(uniqueTypes);

			this.smarthomeSimplifiedByEntityIdExt.set(entry.entityId, entry);
		}
	}

	async initSmarthomeColorsExt() {
		let colorNamesRequired = false;
		for (const entity of this.smarthomeSimplifiedByEntityIdExt.values()) {
			if (entity.actions.includes('setColor')) {
				colorNamesRequired = true;
				break;
			}
		}

		let colorTemperatureNamesRequired = false;
		for (const entity of this.smarthomeSimplifiedByEntityIdExt.values()) {
			if (entity.actions.includes('setColorTemperature')) {
				colorTemperatureNamesRequired = true;
				break;
			}
		}

		if (!colorNamesRequired && !colorTemperatureNamesRequired) {
			return;
		}

		//throw new Error('TESTING');
		const definitions = await this.getSmarthomeBehaviourActionDefinitionsPromise();
		//const definitions = [];

		//tools.log({simplified: this.smarthomeSimplifiedByEntityId});

		// build color names
		// this is not required to succeed

		if (colorNamesRequired) {
			const colorNameOptions = definitions
				.find(x => x.id === 'setColor').parameters
				.find(x => x.name === 'colorName').constraint.options
				.map(option => {
					const hex = known.colorNameToHex.get(option.data);
					const rgb = hex && convert.hex2rgb(hex);
					const hsv = rgb && convert.rgb2hsv(rgb);

					const value = option.data;
					const label = option.displayName;
					//const label = hex ? `${option.displayName} (${hex})` : option.displayName;

					// sort by hue but put grayscale at the back
					let sortkey = !hsv ? Infinity : (hsv[1] !== 0) ? hsv[0] : (hsv[2] + 42);

					return {
						value: value,
						label: label,
						// hex: hex,
						// rgb: rgb,
						// hsv: hsv,
						// color: hex,
						sortkey: sortkey
					};
				})
				.sort((a, b) => a.sortkey - b.sortkey);

			this.colorNamesExt = new Set();
			this.colorNameToLabelExt = new Map();
			this.compareToColorNameExt = new Map();
			for (const { value, label } of colorNameOptions) {
				this.colorNamesExt.add(value);
				this.compareToColorNameExt.set(stringForCompare(value), value);
				this.colorNameToLabelExt.set(value, label);
			}

			this.colorNameToHexExt = new Map();
			for (const [name, hex] of known.colorNameToHex) {
				if (this.colorNamesExt.has(name)) {
					this.colorNameToHexExt.set(name, hex);
				}
			}
		}

		if (colorTemperatureNamesRequired) {
			const colorTemperatureNameOptions = definitions
				.find(x => x.id === 'setColorTemperature').parameters
				.find(x => x.name === 'colorTemperatureName').constraint.options
				.map(option => {
					const number = known.colorTemperatureNameToKelvin.get(option.data);
					const value = option.data;
					const label = option.displayName;
					//const label = number ? `${option.displayName} (${number})` : option.displayName;

					return {
						value: value,
						label: label,
						sortkey: number
					};
				})
				.sort((a, b) => a.sortkey - b.sortkey);

			this.colorTemperatureNamesExt = new Set();
			this.colorTemperatureNameToLabelExt = new Map();
			this.compareToColorTemperatureNameExt = new Map();
			for (const { value, label } of colorTemperatureNameOptions) {
				this.colorTemperatureNamesExt.add(value);
				this.colorTemperatureNameToLabelExt.set(value, label);
				this.compareToColorTemperatureNameExt.set(stringForCompare(value), value);
			}



			this.colorTemperatureNameToKelvinExt = new Map();
			for (const [name, kelvin] of known.colorTemperatureNameToKelvin) {
				if (this.colorTemperatureNamesExt.has(name)) {
					this.colorTemperatureNameToKelvinExt.set(name, kelvin);
				}
			}
		}
	}

	async initRoutinesExt() {
		//throw new Error('TESTING');
		const routines = await this.getAutomationRoutinesPromise();
		this.routineByIdExt = new Map(routines.map(o => [o.automationId, o]));
		this.routineByUtteranceExt = new Map(routines.filter(o => o.triggers && o.triggers[0] && o.triggers[0].type === 'CustomUtterance').map(o => [stringForCompare(o.triggers[0].payload.utterance), o]));
	}

	async initMusicProvidersExt() {
		//throw new Error('TESTING');
		this.musicProvidersExt = await this.getMusicProvidersPromise();
	}

	// short circuit default initializers
	prepare(callback) { callback && callback(); }
	initDeviceState(callback) { callback && callback(); }
	initWakewords(callback) { callback && callback(); }
	initBluetoothState(callback) { callback && callback(); }
	initNotifications(callback) { callback && callback(); }

	// overrides
	find(id) {
		let found;
		if (typeof id === 'object') return id;
		if (typeof id !== 'string') return null;
		if (found = this.deviceByIdExt.get(id)) return found;
		if (found = this.deviceByNameExt.get(stringForCompare(id))) return found;
	}


	findRoutineExt(id) {
		let found;
		if (typeof id === 'object') return id;
		if (typeof id !== 'string') return null;
		if (found = this.routineByIdExt.get(id)) return found;
		if (found = this.routineByUtteranceExt.get(stringForCompare(id))) return found;
	}

	async initAccountExt() {
		return this.getAccountPromise().then(response => {
			for (const account of response) {
				if (account.commsId) {
					this.commsId = account.commsId;
					break;
				}
			}
		});
	}

	_deviceChange() {
		this.deviceByNameExt = new Map(Array.from(this.deviceByIdExt.values(), o => [stringForCompare(o.accountName), o]));
		this.serialNumbers = {};
		for (const device of this.deviceByIdExt.values()) {
			this.serialNumbers[device.serialNumber] = device;
		}
		this.emit('change-device');
	}
	async initDevicesExt() {
		return this.getDevicesPromise().then(response => {
			this.deviceByIdExt = new Map(response.devices?.map(o => [o.serialNumber, o]));
			this._deviceChange();
		});
	}

	_notificationChange() {
		this.notificationByNameExt = new Map(Array.from(this.notificationByIdExt.values())
			.filter(o => o.type === 'Timer' ? o.timerLabel : o.reminderLabel)
			.map(o => [stringForCompare(o.type === 'Timer' ? o.timerLabel : o.reminderLabel), o]));

		this.emit('change-notification');
	}
	async initNotificationsExt() {
		//throw new Error('TESTING');
		return this.getNotificationsPromise().then(response => {
			if (!tools.matches(response, { notifications: [{ id: '' }] })) throw new Error(`unexpected notifications response: "${JSON.stringify(response)}"`);
			this.notificationByIdExt = new Map(response.notifications.map(o => [o.notificationIndex, o]));
			this._notificationChange();
		});
	}

	async updateNotificationsExt(type, id, version) {
		this.notificationUpdatesExt.push({ type: type, id: id, version: version });
		if (DEBUG_THIS) tools.log(`notification update added: ${type} ${id} @ ${version}`);

		if (this.notificationUpdatesRunning) return tools.log(`notification update already running...`);
		this.notificationUpdatesRunning = true;
		if (DEBUG_THIS) tools.log(`notification update starting...`);

		const applyAll = async () => {
			let update;
			while (update = this.notificationUpdatesExt.pop()) {
				const { type, id, version } = update;
				if (DEBUG_THIS) tools.log(`notification update popped: ${type} ${id} @ ${version}`);

				if (type === 'DELETE') {
					const notification = this.notificationByIdExt.get(id);
					if (!notification) {
						tools.log(`notification update apply but already gone: ${type} ${id} @ ${version}`);
						continue;
					}
					this.notificationByIdExt.delete(id);
					if (DEBUG_THIS) tools.log(`notification update apply: ${type} ${id} @ ${version} (previous version: ${notification && notification.version})`);
					this._notificationChange();
				}
				else {
					const notification = this.notificationByIdExt.get(id);
					if (notification && Number(notification.version) >= Number(version)) {
						tools.log(`notification update apply but we are already up to date: ${type} ${id} @ ${version}`);
						continue;
					}
					if (DEBUG_THIS) tools.log(`notification update apply: ${type} ${id} @ ${version} (previous version: ${notification && notification.version})`);
					await this.initNotificationsExt();
				}
			}
		};

		await applyAll().then(() => {
			this.notificationUpdatesRunning = false;
			tools.log(`notification update ended successfully...`);
		}).catch(error => {
			this.notificationUpdatesRunning = false;
			tools.log(`notification update ended erronously...`);
			error.message = `failed to update notifications: ${error.message}`;
			this.logWarn(error);
		});
	}

	async refreshExt() {
		if (!this.cookie || !this.csrf) {
	        await this.refreshAlexaCookies();
	    }
	    return true;
	}

	resetExt() {
		if (this.alexahttp2Push) {
			this.alexahttp2Push.on('error', this.logError);
		}

		if (this.readyState === 1) { 
			this.close();
		}

		if (this.alexaCookie) {
			this.alexaCookie.stopProxyServer();
		}
		if (this.alexahttp2Push) {
			this.alexahttp2Push.on('error', this.logError);
			this.alexahttp2Push.removeAllListeners();
		}

		this.removeAllListeners();
	}

	async httpsGetPromise(noCheck, path, flags) {
		if (typeof noCheck !== 'boolean') {
			flags = path;
			path = noCheck;
			noCheck = false;
		}

		const request = () => new Promise((resolve, reject) => {
			const callback = (err, val) => err ? reject(err) : resolve(val);
			this.httpsGet(noCheck, path, callback, flags);
		});

		return request().catch(async error => {
			if (!isAuthError(error)) {
				throw error;
			}

			await this.refreshAlexaCookies();
			return request();
		});
	}

	// overrides
	generateCookie(email, password, callback) {
		if (!this.alexaCookie) this.alexaCookie = requireUncached('alexa-cookie2');
		this.alexaCookie.generateAlexaCookie(email, password, this._options, callback);
	}

	// overrides
	refreshCookie(callback) {
		// delegates to refreshAlexaCookies for SPA fallback
		this.refreshAlexaCookies()
			.then(() => callback(null, this.cookieData || this.cookie))
			.catch(err => callback(err));
	}

	async sendSequenceNodeExt(sequenceNode) {
		const wrapperNode = {
			'@type': 'com.amazon.alexa.behaviors.model.Sequence',
			startNode: sequenceNode
		};

		const requestData = {
			behaviorId: 'PREVIEW',
			sequenceJson: JSON.stringify(wrapperNode),
			status: 'ENABLED',
		};

		//tools.log({sequenceNode: sequenceNode});

		return this.httpsGetPromise(`/api/behaviors/preview`, {
			method: 'POST',
			data: JSON.stringify(requestData)
		}).catch(error => {
			if (error.message === 'no body') {
				return null; // false positive
			}
			throw error;
		});
	}

	findSmarthomeEntityExt(id) {
		if (typeof id !== 'string' || !this.smarthomeSimplifiedByEntityIdExt) return undefined;

		// by entityId
		let entity = this.smarthomeSimplifiedByEntityIdExt.get(id);
		if (entity) return entity;

		// by applianceId
		for (const entity of this.smarthomeSimplifiedByEntityIdExt.values()) {
			if (entity.applianceId === id) return entity;
		}

		// by name
		const lowercase = id.toLowerCase();
		for (const entity of this.smarthomeSimplifiedByEntityIdExt.values()) {
			if (entity.name.toLowerCase() === lowercase) return entity;
		}

		return undefined;
	}

	async findSmarthomeEntityExtAsync(id) {
		const entity = findSmarthomeEntityExt(id);
		if (!entity) throw new Error(`smarthome entity not found: "${id}"`);
		return entity;
	}

	findSmarthomeColorNameExt(arg) {
		if (typeof arg !== 'string') return undefined;

		if (!arg.startsWith('#')) {
			const string = stringForCompare(arg);
			const name = this.compareToColorNameExt.get(string);
			if (name) return name;
		}

		if (!isHexColor(arg)) return undefined;

		const target = convert.hex2lab(arg);
		let closestDelta = Infinity;
		let closestName;

		for (const [name, hex] of this.colorNameToHexExt) {
			const lab = convert.hex2lab(hex);
			const delta = deltaE(target, lab);
			if (delta < closestDelta) {
				closestDelta = delta;
				closestName = name;
			}
		}

		return closestName;
	}

	findSmarthomeColorTemperatureNameExt(arg) {
		const type = typeof arg;
		if (type === 'string' && !arg.startsWith('#')) {
			const string = stringForCompare(arg);
			const name = this.compareToColorTemperatureNameExt.get(string);
			if (name) return name;
		}

		let target;
		const number = Number(arg);
		if (!Number.isNaN(number)) {
			target = convert.tmp2lab(number);
		}
		else if (isHexColor(arg)) {
			target = convert.hex2lab(arg);
		}

		if (!target) {
			return undefined;
		}

		let closestDelta = Infinity;
		let closestName;

		for (const [name, kelvin] of this.colorTemperatureNameToKelvinExt) {
			const lab = convert.tmp2lab(kelvin);
			const delta = deltaE(target, lab);
			if (delta < closestDelta) {
				closestDelta = delta;
				closestName = name;
			}
		}

		return closestName;
	}

	// requests like ['Lamp 1', '1234-DEAD-BEEF-5678' }]
	async querySmarthomeDeviceStatesExt(requests) {
	    this._requestRateLimitCheck(JSON.stringify(requests));

		const entities = requests.map(request => this.findSmarthomeEntityExt(request.entity));
		const nativeRequests = entities.filter(e => e).map(entity => ({
			entityType: entity.type,
			entityId: entity.applianceId,
		}));

		const response = await querySmarthomeDevicesRawExt(nativeRequests);
		if (!tools.matches(response, { deviceStates: [{}], errors: [{}] }, 2)) {
			throw new Error('unexpected response layout');
		}

		const states = response.deviceStates;
		const errors = response.errors;

		return [states, errors];
	}

	async querySmarthomeDevicesExt(stateRequests) {
   	    this._requestRateLimitCheck(JSON.stringify(stateRequests));

		/*
		'stateRequests': [
			{
				'entityId': 'AAA_SonarCloudService_00:17:88:01:04:1D:4C:A0',
				'entityType': 'APPLIANCE'
			}
		]
		*/

		const flags = {
			method: 'POST',
			data: JSON.stringify({
				'stateRequests': stateRequests
			})
		};

		return this.httpsGetPromise('/api/phoenix/state', flags);
	}

	async executeSmarthomeDeviceActionExt(controlRequests) {
	    this._requestRateLimitCheck(JSON.stringify(controlRequests));
		/*
        {
            'controlRequests': [
                {
                    'entityId': 'bbd72582-4b16-4d1f-ab1b-28a9826b6799',
                    'entityType':'APPLIANCE',
                    'parameters':{
                        'action':'turnOn'
                    }
                }
            ]
		}
		*/

		const flags = {
			method: 'PUT',
			data: JSON.stringify({
				'controlRequests': controlRequests
			})
		};

		return this.httpsGetPromise('/api/phoenix/state', flags);
	}

	async deleteSmarthomeDeviceExt(id) {
		return new Promise((resolve, reject) => {
			const entity = this.findSmarthomeEntityExt(id);
			if (!entity || entity.type !== 'APPLIANCE') throw new Error(`smarthome device not found: "${id}"`);
			this.deleteSmarthomeDevice(entity.applianceId, (err, val) =>
				err && err.message !== 'no body' ? reject(err) : resolve(val)
			);
		});
	}

	async deleteSmarthomeGroupExt(id) {
		return new Promise((resolve, reject) => {
			const entity = this.findSmarthomeEntityExt(id);
			if (!entity || entity.type !== 'GROUP') throw new Error(`smarthome group not found: "${id}"`);
			this.deleteSmarthomeGroup(entity.groupId, (err, val) =>
				err && err.message !== 'no body' ? reject(err) : resolve(val)
			);
		});
	}

	async deleteAllSmarthomeDevicesExt() {
		return new Promise((resolve, reject) => {
			this.deleteAllSmarthomeDevices((err, val) =>
				err && err.message !== 'no body' ? reject(err) : resolve(val)
			);
		});
	}

	// type like "TASK" or "SHOPPING_ITEM"
	async getListExt(type = 'TASK', size = 100) {
		if (!['TASK', 'SHOPPING_ITEM'].includes(type)) throw new Error(`invalid list type: "${type}"`);
		return this.httpsGetPromise(`/api/todos?type=${type}&size=${size}&_=%t`);
	}

	// type like "TASK" or "SHOPPING_ITEM"
	async addListItemExt(type, text) {
		if (!['TASK', 'SHOPPING_ITEM'].includes(type)) throw new Error(`invalid list type: "${type}"`);

		const request = {
			type: type,
			text: text,
			createdDate: new Date().getTime(),
			completed: false,
			deleted: false,
		};

		this.httpsGetPromise(`/api/todos`, {
			method: 'POST',
			data: JSON.stringify(request),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
			}
		});
	}

	findNotificationExt(id) {
		let found;
		if (found = this.notificationByIdExt.get(id)) return found;
		if (found = this.notificationByNameExt.get(stringForCompare(id))) return found;
	}

	// type like "Reminder" or "Alarm" or "Timer"
	// status like "ON" or "OFF" or "PAUSED"
	createNotificationObjectExt(serialOrName, type, label, time, status = 'ON', sound = null) {
		const device = this.find(serialOrName);
		if (!device) throw new Error('device not found');
		if (!['Reminder', 'Alarm', 'Timer'].includes(type)) throw new Error(`invalid notification type: "${type}"`);
		if (!['ON', 'OFF', 'PAUSED'].includes(status)) throw new Error(`invalid notification status: "${status}"`);
		const timer = type === 'Timer';
		time = Number(timer ? tools.parseDuration(time) : new Date(time).getTime());
		if (Number.isNaN(time)) throw new Error('invalid date/time');
		const now = Date.now();
		const [Y, M, D, h, m, s, u] = timer ? [] : tools.dateToStringPieces(new Date(time));

		return {
			"alarmTime": timer ? 0 : time,
			"createdDate": now,
			"deferredAtTime": null,
			"deviceSerialNumber": device.serialNumber,
			"deviceType": device.deviceType,
			"extensibleAttribute": null,
			"geoLocationTriggerData": null,
			"id": `${device.deviceType}-${device.serialNumber}-${type.toLowerCase()}-${now}`,
			"lastUpdatedDate": now,
			"musicAlarmId": null,
			"musicEntity": null,
			"notificationIndex": `${type.toLowerCase()}-${now}`,
			"originalDate": timer ? null : `${Y}-${M}-${D}`,
			"originalTime": timer ? null : `${h}:${m}:${s}.${u}`,
			"personProfile": null,
			"provider": null,
			"rRuleData": type !== 'Reminder' ? null : {
				"byMonthDays": null,
				"byWeekDays": null,
				"flexibleRecurringPatternType": null,
				"frequency": null,
				"intervals": null,
				"nextTriggerTimes": null,
				"notificationTimes": null,
				"recurEndDate": null,
				"recurEndTime": null,
				"recurStartDate": null,
				"recurStartTime": null,
				"recurrenceRules": null
			},
			"recurringPattern": null,
			"remainingTime": timer ? time : 0,
			"reminderLabel": timer ? null : label,
			"skillInfo": null,
			"snoozedToTime": null,
			"sound": sound ? sound : {
				"displayName": "Simple Alarm",
				"folder": null,
				"id": "system_alerts_melodic_01",
				"providerId": "ECHO",
				"sampleUrl": "https://s3.amazonaws.com/deeappservice.prod.notificationtones/system_alerts_melodic_01.mp3"
			},
			"status": status,
			"targetPersonProfiles": null,
			"timeZoneId": null,
			"timerLabel": timer ? label : null,
			"triggerTime": 0,
			"type": type,
			"version": '1'
		};
	}

	changeNotificationObjectExt(notification, label, time, status, sound) {
		if (status && !['ON', 'OFF', 'PAUSED'].includes(status)) throw new Error(`invalid notification status: "${status}"`);

		const timer = notification.type === 'Timer';
		if (time) {
			time = Number(timer ? tools.parseDuration(time) : new Date(time).getTime());
			if (Number.isNaN(time)) throw new Error('invalid date/time');
		}

		if (timer) {
			if (status !== notification.status) notification.triggerTime = Date.now();
			if (label) notification.timerLabel = label;
			//if(time) notification.remainingTime = time;
			notification.remainingTime = time || null;
		}
		else {
			const [Y, M, D, h, m, s, u] = tools.dateToStringPieces(new Date(time));
			notification.reminderIndex = null;
			notification.isSaveInFlight = true;
			notification.isRecurring = !!notification.recurringPattern; // ?? i guess....
			if (status) notification.status = status;
			if (label) notification.reminderLabel = label;
			if (time) {
				notification.alarmTime = time;
				notification.originalDate = `${Y}-${M}-${D}`;
				notification.originalTime = `${h}:${m}:${s}.${u}`;
			}
		}

		if (status) notification.status = status;
		if (sound) notification.sound = sound;
	}

	async createNotificationExt(serialOrName, type, label, time, status, sound) {
		const notification = this.createNotificationObjectExt(serialOrName, type, label, time, status, sound);

		return this.httpsGetPromise(`/api/notifications/createReminder`, {
			data: JSON.stringify(notification),
			method: 'PUT',
		}).then(notification => {
			this.notificationByIdExt.set(notification.notificationIndex, notification);
			this._notificationChange();
			return notification;
		});
	}

	async changeNotificationExt(notification, label, time, status, sound) {
		const found = typeof notification === 'object' ? notification : this.findNotificationExt(notification);
		if (!found) throw new Error(`notification not found: "${notification}"`);
		const changed = tools.clone(found);
		this.changeNotificationObjectExt(changed, label, time, status, sound);

		return this.httpsGetPromise(`/api/notifications/${changed.id}`, {
			data: JSON.stringify(changed),
			method: 'PUT',
		}).then(notification => {
			this.notificationByIdExt.set(notification.notificationIndex, notification);
			this._notificationChange();
			return notification;
		});
	}

	async deleteNotificationExt(notification) {
		const found = typeof notification === 'object' ? notification : this.findNotificationExt(notification);
		if (!found) throw new Error(`notification not found: "${notification}"`);

		return this.httpsGetPromise(`/api/notifications/${found.id}`, {
			data: JSON.stringify(found),
			method: 'DELETE',
		}).catch(error => {
			if (error.message === 'no body') return;
			throw error;
		}).then(response => {
			this.updateNotificationsExt('DELETE', found.notificationIndex, found.version);
			return response;
		});
	}

	async getSoundsExt(device) {
		const found = this.find(device);
		if (!found) throw new Error(`device not found: "${device}"`);
		const response = await this.httpsGetPromise(`/api/notification/migration/sounds?deviceSerialNumber=${found.serialNumber}&deviceType=${found.deviceType}&softwareVersion=${found.softwareVersion}&_=%t`);
		ensureMatch(response, { notificationSounds: [{}] });
		return response.notificationSounds;
	}

	async getDefaultSound(device, notificationType = 'Alarm') {
		const found = this.find(device);
		if (!found) throw new Error(`device not found: "${device}"`);

		return this.httpsGetPromise(`/api/notification/migration/default-sound?deviceSerialNumber=${found.serialNumber}&deviceType=${found.deviceType}&softwareVersion=${found.softwareVersion}&notificationType=${notificationType.toUpperCase()}&_=%t`);
	}

	async getDeviceNotificationStatesExt() {
		const response = await this.httpsGetPromise(`/api/device-notification-state&_=%t`);
		ensureMatch(response, { deviceNotificationStates: [{}] });
		return response.deviceNotificationStates;
	}

	async findAsync(device) {
		const found = this.find(device);
		if (!found) throw new Error(`device not found: "${device}"`);
		return found;
	}

	async getCustomerId() {
		const response = await new Promise((resolve, reject) => {
			const callback = (err, val) => err ? reject(err) : resolve(val);
			this.getUsersMe(callback);
		});
		ensureMatch(response, { id: '' });
		return response.id;
	}

	async checkAuthenticationExt() {
		return new Promise((resolve, reject) => {
			this.checkAuthentication((authenticated, error) =>
				error ? (isAuthError(error) ? resolve(false) : reject(error)) : resolve(authenticated)
			);
		});
	}

	async renameDeviceExt(device, name) {
		const found = await this.findAsync(device);
		return this.renameDevicePromise(found, name).then(response => {
			if (!tools.matches(response, { accountName: '', serialNumber: '' })) return response;
			found.accountName = response.accountName;
			//this.deviceByIdExt.set(response.serialNumber, response);
			this._deviceChange();
			return found;
		});
	}

	async deleteDeviceExt(device) {
		const found = await this.findAsync(device);
		return this.deleteDevicePromise(found).then(response => {
			this.deviceByIdExt.delete(found.serialNumber);
			this._deviceChange();
			return response;
		}).catch(error => {
			if (error.message === 'no body') return;
			throw error;
		});
	}

	async validateRoutineNodeExt(node) {
		return this.httpsGetPromise(`/api/behaviors/operation/validate`, {
			method: 'POST',
			data: JSON.stringify(node)
		}).then(response => {
			if (response.result !== 'VALID') throw new Error('invalid routine');
			node.operationPayload = response.operationPayload;
			return node;
		});
	}

	async pairBluetoothExt(device, bluetoothAddress) {
		const found = await this.findAsync(device);
		return this.httpsGetPromise(`/api/bluetooth/pair-sink/${found.deviceType}/${found.serialNumber}`, {
			method: 'POST',
			data: JSON.stringify({
				bluetoothDeviceAddress: bluetoothAddress
			})
		}).catch(error => {
			if (error.message === 'no body') return;
			throw error;
		});
	}

	async unpairBluetoothExt(device, bluetoothAddress) {
		const found = await this.findAsync(device);
		return this.httpsGetPromise(`/api/bluetooth/unpair-sink/${found.deviceType}/${found.serialNumber}`, {
			method: 'POST',
			data: JSON.stringify({
				bluetoothDeviceAddress: bluetoothAddress,
				bluetoothDeviceClass: 'OTHER',
			})
		}).catch(error => {
			if (error.message === 'no body') return;
			throw error;
		});
	}

	async disconnectBluetoothExt(device, bluetoothAddress) {
		const found = await this.findAsync(device);
		return this.httpsGetPromise(`/api/bluetooth/disconnect-sink/${found.deviceType}/${found.serialNumber}`, {
			method: 'POST'
		}).catch(error => {
			if (error.message === 'no body') return;
			throw error;
		});
	}

	async getSkillsExt() {
		return this.httpsGetPromise(`https://skills-store.${this._options.amazonPage}/app/secure/your-skills-page?deviceType=app&ref-suffix=ysa_gw&pfm=A1PA6795UKMFR9&cor=DE&lang=en-us&_=%t`, {
			method: 'GET',
			headers: {
				'Accept': 'application/vnd+amazon.uitoolkit+json;ns=1;fl=0',
				// 'Accept-Encoding': 'gzip, deflate, br',
				'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
				'Connection': 'keep-alive',
				'Host': `skills-store.${this._options.amazonPage}`,
				'Origin': `https://alexa.${this._options.amazonPage}`,
				'Referer': `https://alexa.${this._options.amazonPage}/spa/index.html?returnFromLogin=1`,
				'Sec-Fetch-Mode': 'cors',
				'Sec-Fetch-Site': 'same-site',
			}
		}).then(response => {
			return response
				.find(o => o.block === 'data' && Array.isArray(o.contents))
				.contents
				.find(o => o.id === 'skillsPageData')
				.contents
				.products
				.map(o => ({
					id: o.productMetadata.skillId,
					name: o.title,
					type: o.productDetails.skillTypes[0]
				}));
		});
	}
}

module.exports = AlexaRemoteExt;

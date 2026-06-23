const util = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readFileAsync = util.promisify(fs.readFile);
const EventEmitter = require('events');

const AlexaRemote = require('../lib/alexa-remote-ext.js');
const tools = require('../lib/common.js');
const pjson = require('../package.json')

// we are building all sorts of json payloads to send to the webpage when
// initializing the account (can be updated via an 'update' query or account.updateAlexa)
// they are built by the account.builders and stored in account.ui
// any error that happens during building these payloads are reported in
// the json payload account.ui.errors

const uiJsonBuilders = {
	devices: async (alexa, fresh = true) => {
		function getIcon(device) {
			switch(device.deviceFamily) {
				case 'TABLET':                        return 'f10a'; // tablet
				case 'VOX':                           return 'f007'; // user
				case 'THIRD_PARTY_AVS_MEDIA_DISPLAY': return 'f135'; // app
				case 'ECHO':                          return 'f270'; // amazon
				case 'FIRE_TV':                       return 'f06d'; // fire
				case 'WHA':                           return 'f247'; // object-group
				case 'AMAZONMOBILEMUSIC_ANDROID':     return 'f17b'; // android
				default:                              return 'f059'; // question-circle
			}
		}
	
		function getLabel(device) {
			return `&#x${getIcon(device)};  ${device.accountName}`
		}
	
		function getSortValue(device) {
			let value = device.accountName ? device.accountName.charCodeAt(0) : 0;
		
			switch(device.deviceFamily) {
				case 'ECHO':                          value -= 1000;
				case 'WHA':                           value -= 1000;
				case 'FIRE_TV':                       value -= 1000;
				case 'TABLET':                        value -= 1000;
				case 'VOX':                           value -= 1000;
				case 'THIRD_PARTY_AVS_MEDIA_DISPLAY': value -= 1000;
				case 'AMAZONMOBILEMUSIC_ANDROID':     value -= 1000;
				default:                              value -= 1000;
			}
		
			return value;
		}
	
		if(fresh) {
			await alexa.initDevicesExt();
		}
	
		return JSON.stringify(Array.from(alexa.deviceByIdExt.values())
       		.filter(d => d.deviceFamily != 'WHA' || d.clusterMembers.length > 0)
			.sort((a,b) => getSortValue(a) - getSortValue(b))
			.map(x => [x.serialNumber, getLabel(x), x.capabilities])
		);
	},
	smarthome: async (alexa, fresh = true) => {
		function getIcon(applianceType) {
			switch(applianceType) {
				case 'LIGHT':               return 'f0eb'; // lightbulb-o 
				case 'SWITCH':              return 'f205'; // toggle-on
				case 'THERMOSTAT':          return 'f2c9'; // thermometer-half
				case 'SMARTLOCK':           return 'f084'; // key
				case 'SCENE_TRIGGER':       return 'f144'; // play-circle
				case 'ACTIVITY_TRIGGER':    return 'f0f3'; // bell
				case 'HUB':                 return 'f233'; // server
				case 'ECHO': /*not native*/ return 'f270'; // amazon
				case 'OTHER':               return 'f2db'; // microchip
				default:                    return 'f128'; // question
			}
		}
	
		function getLabel(entity) {
			if(entity.type === 'APPLIANCE') {
				return entity.applianceTypes.map(getIcon).map(c => `&#x${c};`).join('') + `  ${entity.name}`;
			}
			else {
				const icon = 'f247'; // object-group
				return `&#x${icon};  ${entity.name}`; 
			}
		}

		if(fresh) {
			await Promise.all([
				alexa.initSmarthomeSimplifiedExt(),
				alexa.initSmarthomeColorsExt(),
			]);
		}
	
		const entityById = Array.from(alexa.smarthomeSimplifiedByEntityIdExt.values())
			.filter(e => !e.isDuplicate)
			.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === 'APPLIANCE' ? -1 : 1;
				}
	
				const an = a.name.toLowerCase();
				const bn = b.name.toLowerCase();
	
				return an < bn ? -1 : an > bn ? 1 : 0;
			})
			.reduce((obj, entity) => (obj[entity.entityId] =
				[getLabel(entity), entity.properties, entity.actions, entity.type],
				obj), {});
	
		const colorNames = Array.from(alexa.colorNameToLabelExt.entries());
		const colorTemperatureNames = Array.from(alexa.colorTemperatureNameToLabelExt.entries());
	
		//tools.log({smarthomeForUi: smarthomeForUi}, 10, 250);
		return JSON.stringify({
			entityById: entityById,
			colorNames: colorNames,
			colorTemperatureNames: colorTemperatureNames,
		});
	},
	bluetooth: async (alexa, fresh = true) => {
		function getLabel(device) {
			return device.friendlyName;
		}
	
		return JSON.stringify((await alexa.getBluetoothPromise()).bluetoothStates
			.filter(state => Array.isArray(state.pairedDeviceList))
			.reduce((o, state) => (o[state.deviceSerialNumber] = state.pairedDeviceList
				.map(device => [device.address, getLabel(device)]
			), o), {})
		);
	},
	notifications: async (alexa, fresh = true) => {
		function getLabel(not) {
			if(!tools.matches(not, { type: '', status: '', id: ''})) return `&#xf059;  ???`;
		
			const name = not.type === 'Timer' ? not.timerLabel : not.reminderLabel;
			const suffix = not.status === 'ON' ? '' : ` (${String(not.status).toLowerCase()})`;
			const icon = not.type === 'Timer' ? 'f017' : not.type === 'Alarm' ? 'f0f3' : not.type === 'Reminder' ? 'f073' : 'f059';
			const shortId = not.id.slice(not.id.lastIndexOf('-') + 1);
			const shortTime = (not.originalTime || '').slice(0, 5);
		
			return `&#x${icon};  ${name || (not.type === 'Alarm' ? shortTime : shortId)}${suffix}`;
		}

		const getSortValue = (noti) => {
			const name = noti.type === 'Timer' ? noti.timerLabel : noti.reminderLabel;		
		
			const nameValue = name ? name.charCodeAt(0) : 1000;
		
			const typeValue = 
					noti.type === 'Timer' ? 0
				: noti.type === 'Alarm' ? 10000
				: noti.type === 'Reminder' ? 20000
				: 30000;
		
			return nameValue + typeValue;
		};

		return JSON.stringify(Array.from(alexa.notificationByIdExt.values())
			.sort((a,b) => getSortValue(a) - getSortValue(b))
			.map(noti => [noti.notificationIndex, getLabel(noti), noti.type, noti.deviceSerialNumber])
		);
	},
	routines: async (alexa, fresh = true) => {
		function getLabel(routine, smarthomeSimplifiedByEntityIdExt) {
			routine = tools.isObject(routine) && routine || {};
			const id = String(routine.automationId);
			const trigger = Array.isArray(routine.triggers) && routine.triggers[0] || {}; 
			const type = trigger.type || '';
			const disabled = routine.status === 'DISABLED';
			const suffix = disabled ? ' (disabled)' : '';
		
			// const shortId = 
			// 	  id.startsWith('amzn1.alexa.automation') 				? id.slice(id.lastIndexOf('-') + 1) 
			// 	: id.startsWith('amzn1.alexa.behaviors.preconfigured') 	? tools.keyToLabel(id.slice(id.lastIndexOf(':') + 1, tools.nthIndexOf(id, '_', 1)))
			// 	: '???';
		
			if(type.startsWith('Alexa.Trigger.Alarms')) {
				let action = type.slice(type.lastIndexOf('.') + 1);
				if(action === 'NotificationStopped') action = 'dismissed';
				return `&#xf0f3;  Alarm ${tools.keyToLabel(action)}${suffix}`; //bell
			}
		
			if(type.startsWith('Alexa.Trigger.Gadget.EchoButton')) {
				let action = type.slice(type.lastIndexOf('.') + 1);
				let shortId = trigger.payload.gadgetDsn.slice(-3);
				if(action === 'ButtonPress') action = 'pressed';
				return `&#xf111;  Button ${shortId} ${tools.keyToLabel(action)}${suffix}`; // circle
			}
		
			if(type === 'CustomUtterance') {
				const utterance = trigger.payload.utterance;
				return `&#xf130;  "${utterance}"`; // microphone
			}
		
			if(type === 'motionSensorDetectionStateTrigger') {
				const entityId = trigger.payload.target;
				const entity = smarthomeSimplifiedByEntityIdExt.get(entityId);
				const name = entity && entity.name || '???';
				return `&#xf047;  Motion in ${name}${suffix}`; // arrows
			}
		
			if(type === 'AbsoluteTimeSchedule') {
				const time = trigger.schedule && trigger.schedule.triggerTime || '??????';
				const formatted = `${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}`;
				return `&#xf017;  Schedule ${formatted}${suffix}`; // clock-o
			}
		
			return `&#xf059;  ${id}${suffix}`; // question-circle
		}

		if(fresh) {
			await alexa.initRoutinesExt();
		}

		return JSON.stringify(Array.from(alexa.routineByIdExt.values())
			.sort((a,b) => (a.status === 'DISABLED' ? 1 : -1) - (b.status === 'DISABLED' ? 1 : -1))
			.map(routine => [routine.automationId, getLabel(routine, alexa.smarthomeSimplifiedByEntityIdExt)]));
	},
	musicProviders: async(alexa, fresh = true) => {
		if(fresh) {
			await alexa.initMusicProvidersExt();
		}

		return JSON.stringify(alexa.musicProvidersExt
			.filter(provider => provider.supportedOperations.includes('Alexa.Music.PlaySearchPhrase'))
			.map(provider => [provider.id, provider.displayName]));
	},
	skills: async(alexa, fresh = true) => {
		function getIcon(skill) {
			switch(skill.type) {
				case 'CUSTOM':           return 'f013'; // cog
				case 'SMART_HOME':       return 'f015'; // home
				case 'CONTENT':          return 'f1ea'; // newspaper-o
				default:                 return 'f059'; // question-circle
			}
		}
	
		function getLabel(skill) {
			return `&#x${getIcon(skill)};  ${skill.name}`;
		}

		return JSON.stringify((await alexa.getSkillsExt())
			.map(o => [o.id, getLabel(o)])
		);
	},
	lists: async (alexa, fresh = true) => {
		function getIcon(list) {
			switch(list.listType) {
				case 'SHOP':          return 'f07a'; // shopping-cart
				case 'TODO':          return 'f14a'; // check-square
				default:              return 'f03a'; // list
			}
		}
	
		function getName(list) {
			if(list.listName) return list.listName;
	
			switch(list.listType) {
				case 'SHOP':          return 'Shopping';
				case 'TODO':          return 'To-do';
				default:              return 'Unnamed';
			}
		}
	
		function getLabel(list) {
			return `&#x${getIcon(list)};  ${getName(list)}`;
		}
	
		return JSON.stringify((await alexa.getListsV2Promise())
			.filter(x => x.listStatus == 'ACTIVE')
			.map(x => [x.listId, getLabel(x)])
		);
	},
};

function accountHttpResponse(RED, property, label, req, res) {
	const account = RED.nodes.getNode(req.query.account);
	
	if(!account) {
		res.writeHeader(400, {'Content-Type': 'text/plain'});
		return res.end(`Could not load ${label}: Account not deployed!`);
	}
	
	if(account.state.code !== 'READY') {
		res.writeHeader(400, {'Content-Type': 'text/plain'});
		return res.end(`Could not load ${label}: Account not initialised!`);
	}
	
	// this won't throw, update failures are reported through ui.errors
	(req.query.refresh === '1' ? account.builders[property]() : Promise.resolve()).then(() => {
		if(!account.ui.hasOwnProperty(property)) {
			res.writeHeader(500, {'Content-Type': 'text/plain'});
			return res.end(`Could not load ${label}: Account is missing "${property}" property!`);
		}

		res.writeHeader(200, {'Content-Type': 'application/json'});
		res.end(typeof account.ui[property] === 'string' ? account.ui[property] : JSON.stringify(account.ui[property]));
	});
}

module.exports = function (RED) {
	function AlexaRemoteAccountNode(input) {
		RED.nodes.createNode(this, input);

		tools.assign(this, ['authMethod', 'proxyOwnIp', 'proxyPort', 'cookieFile', 'refreshInterval', 'alexaServiceHost', 'pushDispatchHost', 'amazonPage', 'acceptLanguage', 'onKeywordInLanguage', 'userAgent'], input);
		this.usePushConnection = input.usePushConnection === 'on';
		this.autoQueryActivityOnTrigger = input.autoQueryActivityOnTrigger === "on";
		this.autoInit  = input.autoInit  === 'on';
		this.name = input.name;
		this.onKeywordInLanguage = input.onKeywordInLanguage;
		this.locale = this.acceptLanguage;
		this.refreshInterval = Number(this.refreshInterval) * 1000 * 60 * 60 * 24;
		if(this.refreshInterval < 15000) this.refreshInterval = NaN;

		this.alexa = new AlexaRemote({ context: this.context() }).setMaxListeners(32);
		this.emitter = new EventEmitter().setMaxListeners(128);
		this.initing = false;
		this.state = { code: 'UNINITIALISED', message: '' };
		this.debugCb = tools.nodeGetDebugCb(this);
		this.logCb = tools.nodeGetLogCb(this);
		this.warnCb = tools.nodeGetWarnCb(this);
		this.errorCb = tools.nodeGetErrorCb(this);

		const configuredAuthDebugLogFile = process.env.APPLESTRUDEL_AUTH_DEBUG_LOG;
		const configuredAuthDebugLogDir = process.env.APPLESTRUDEL_AUTH_DEBUG_DIR;
		this.authDebugEnabled = !!(configuredAuthDebugLogFile || configuredAuthDebugLogDir);
		this.authDebugLogDir = this.authDebugEnabled
			? (configuredAuthDebugLogFile ? path.dirname(configuredAuthDebugLogFile) : configuredAuthDebugLogDir)
			: null;
		this.authDebugLogFile = this.authDebugEnabled
			? (configuredAuthDebugLogFile || path.join(this.authDebugLogDir, 'authdbg.jsonl'))
			: null;
		this.authDebugSensitiveKey = key => {
			const text = String(key || '');
			return /(loginCookie|localCookie|^cookie$|Cookie$|set-cookie|token|access_token|refresh_token|source_token|authorization|openid(?:\.|_|$)|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|^serial$|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session|^code$|^state$)/i.test(text);
		};
		this.authDebugShape = (value, depth = 0, key = '') => {
			if (value === undefined) return { type: 'undefined', present: false };
			if (value === null) return { type: 'null', present: false };
			if (this.authDebugSensitiveKey(key)) {
				const text = typeof value === 'string' ? value : JSON.stringify(value);
				return { type: typeof value, present: !!value, length: text ? text.length : 0 };
			}
			if (typeof value === 'string') {
				const sanitized = this.authDebugSanitizeText(value);
				return { type: 'string', present: sanitized.length > 0, length: sanitized.length, value: sanitized.length <= 160 ? sanitized : sanitized.slice(0, 160) };
			}
			if (typeof value === 'number' || typeof value === 'boolean') return value;
			if (Array.isArray(value)) return { type: 'array', length: value.length, sample: depth < 1 ? value.slice(0, 6).map(v => this.authDebugShape(v, depth + 1)) : undefined };
			if (typeof value === 'object') {
				const keys = Object.keys(value).sort();
				const shaped = { type: 'object', keys };
				if (depth < 2) {
					shaped.values = {};
					for (const childKey of keys) shaped.values[childKey] = this.authDebugShape(value[childKey], depth + 1, childKey);
				}
				return shaped;
			}
			return { type: typeof value, value: String(value) };
		};
		this.authDebugMaskJsonValue = (value, key = '') => {
			if (this.authDebugSensitiveKey(key)) return '[AUTHDBG_MASKED]';
			if (Array.isArray(value)) return value.map(item => this.authDebugMaskJsonValue(item));
			if (value && typeof value === 'object') {
				const masked = {};
				for (const childKey of Object.keys(value)) masked[childKey] = this.authDebugMaskJsonValue(value[childKey], childKey);
				return masked;
			}
			if (typeof value === 'string') return this.authDebugSanitizeText(value);
			return value;
		};
		this.authDebugSanitizeJsonLine = line => {
			try {
				return JSON.stringify(this.authDebugMaskJsonValue(JSON.parse(line)));
			}
			catch (_err) {
				return null;
			}
		};
		this.authDebugJsonFragmentEnd = (text, start) => {
			const stack = [];
			let inString = false;
			let escaped = false;

			for (let i = start; i < text.length; i++) {
				const char = text[i];
				if (inString) {
					if (escaped) {
						escaped = false;
					}
					else if (char === '\\') {
						escaped = true;
					}
					else if (char === '"') {
						inString = false;
					}
					continue;
				}
				if (char === '"') {
					inString = true;
				}
				else if (char === '{') {
					stack.push('}');
				}
				else if (char === '[') {
					stack.push(']');
				}
				else if (stack.length && char === stack[stack.length - 1]) {
					stack.pop();
					if (!stack.length) return i;
				}
			}
			return -1;
		};
		this.authDebugSanitizeJsonFragments = value => {
			const text = String(value);
			let sanitized = '';
			let offset = 0;
			while (offset < text.length) {
				const objectIndex = text.indexOf('{', offset);
				const arrayIndex = text.indexOf('[', offset);
				const start = objectIndex === -1 ? arrayIndex : (arrayIndex === -1 ? objectIndex : Math.min(objectIndex, arrayIndex));
				if (start === -1) {
					sanitized += text.slice(offset);
					break;
				}
				const end = this.authDebugJsonFragmentEnd(text, start);
				if (end === -1) {
					sanitized += text.slice(offset);
					break;
				}
				const fragment = text.slice(start, end + 1);
				sanitized += text.slice(offset, start) + (this.authDebugSanitizeJsonLine(fragment) || fragment);
				offset = end + 1;
			}
			return sanitized;
		};
		this.authDebugSanitizeCookieHeader = value => String(value).replace(/\b(Cookie\s*:\s*)([^\n\r]+)/gi, (_match, prefix, cookieText) =>
			prefix + cookieText.replace(/([^=;\s]+)=([^;\s\n\r]+)/g, '$1=[AUTHDBG_MASKED]')
		);
		this.authDebugSanitizeText = value => this.authDebugSanitizeCookieHeader(
			this.authDebugSanitizeJsonFragments(
				String(value).split(/\r?\n/).map(line => this.authDebugSanitizeJsonLine(line) || line).join('\n')
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
			.replace(/(^|[^A-Za-z0-9+.-:/])\/(?:homeassistant|tmp|var|opt|etc|srv|home|Users|data|config|root|mnt)(?=\/|$)(?:\/[^\/?"'\s\n\r,;}#&]+)*/g, '$1[AUTHDBG_PATH_MASKED]');
		this.authDebugWrite = (event, details = {}) => {
			try {
				if (!this.authDebugEnabled) return;
				fs.mkdirSync(this.authDebugLogDir, { recursive: true });
				const entry = {
					ts: new Date().toISOString(),
					component: 'node-red-account',
					event,
					details: this.authDebugShape(details)
				};
				fs.appendFileSync(this.authDebugLogFile, JSON.stringify(entry) + '\n', 'utf8');
			} catch (_err) {
				// observation must never change auth flow
			}
		};
		this.authDebugLogger = line => {
			const sanitized = this.authDebugSanitizeText(line);
			try {
				if (this.authDebugEnabled) {
					fs.mkdirSync(this.authDebugLogDir, { recursive: true });
					fs.appendFileSync(this.authDebugLogFile, JSON.stringify({
						ts: new Date().toISOString(),
						component: 'library',
						event: 'logger',
						line: sanitized
					}) + '\n', 'utf8');
				}
			} catch (_err) {
				// observation must never change auth flow
			}
			this.debugCb(sanitized);
		};
		['log', 'debug', 'info', 'warn', 'error'].forEach(level => {
			this.authDebugLogger[level] = this.authDebugLogger;
		});
		this.authDebugWrite('account.constructed', {
			name: this.name,
			authMethod: this.authMethod,
			proxyOwnIp: this.proxyOwnIp,
			proxyPort: this.proxyPort,
			cookieFile: this.cookieFile,
			amazonPage: this.amazonPage,
			acceptLanguage: this.acceptLanguage,
			userAgent: this.userAgent,
			autoInit: this.autoInit
		});

		this.refreshTimeoutStartTime = null;
		this.refreshTimeout = null;
		this.errorMessages = {};
		this.ui = {};
		this.builders = {};
		this.persistCookieData = () => {
			this.authDebugWrite('account.persist.enter', {
				authMethod: this.authMethod,
				cookieFile: this.cookieFile,
				hasAlexa: !!this.alexa,
				cookieData: this.alexa && this.alexa.cookieData
			});
			if (this.authMethod !== 'proxy' || !this.cookieFile || !this.alexa || !this.alexa.cookieData) {
				this.authDebugWrite('account.persist.skip', {
					authMethod: this.authMethod,
					hasCookieFile: !!this.cookieFile,
					hasAlexa: !!this.alexa,
					hasCookieData: !!(this.alexa && this.alexa.cookieData)
				});
				return;
			}
			const json = JSON.stringify(this.alexa.cookieData);
			try {
				fs.writeFileSync(this.cookieFile, json, 'utf8');
				const stat = fs.statSync(this.cookieFile);
				this.authDebugWrite('account.persist.written', { cookieFile: this.cookieFile, bytes: stat.size, mtimeMs: stat.mtimeMs });
			}
			catch (error) {
				this.authDebugWrite('account.persist.error', { message: error && error.message, code: error && error.code });
				this.warnCb(error);
			}
		};
		this.attachAlexaHandlers = () => {
			if (!this.alexa) return;
			this.alexa.on('cookie', () => this.persistCookieData());
		};

		this.attachAlexaHandlers();

		this.buildUiErrorJson = async () => {
			const a = this.errorMessages;
			const b = this.alexa.errorMessagesExt;
			const keys = new Set(Object.getOwnPropertyNames(a), Object.getOwnPropertyNames(b));
			const combined = {};

			for(const key of keys) {
				combined[key] = a[key] || b[key];
			}

			this.ui.errors = JSON.stringify(combined);
		};
		this.buildUiJson = async (fresh = true) => {
			await Promise.all(Object.values(this.builders).map(fn => fn(fresh)));
		};
		this.captureErrorMessage = async function(name, asyncFn) {
			return asyncFn().then(some => {
				delete this.errorMessages[name];
				this.buildUiErrorJson();
				return some;
			}).catch(error => {
				this.errorMessages[name] = error.message;
				this.buildUiErrorJson();
				throw error;
			}).catch(this.warnCb);
		};
				
		Object.keys(uiJsonBuilders).forEach(key => {
			this.builders[key] = async(fresh = true) => this.captureErrorMessage(key, async () => {
				this.ui[key] = await uiJsonBuilders[key](this.alexa, fresh);
			});
		});

		this.setState = function(code, message) {
			this.state = {
				code: code,
				message: message || code
			};
			this.emitter.emit('state', code, message);
		};
		this.renewTimeout = function() {
			if(this.refreshTimeout !== null) {
				clearTimeout(this.refreshTimeout);
				this.refreshTimeout = null;
			}

			if(!this.refreshInterval) return;
			if(this.state.code !== 'READY') return;

			this.refreshTimeoutStartTime = Date.now();
			this.refreshTimeout = setTimeout(() => {
				this.log('auto refreshing cookie...');
				this.refreshAlexa().catch(this.errorCb);
			}, this.refreshInterval);
		};
		this.resetAlexa = function () {
			if(this.refreshTimeout !== null) {
				clearTimeout(this.refreshTimeout);
				this.refreshTimeout = null;
			}
			if (!this.alexa) return;
			this.alexa.resetExt();
			this.initialised = false;
			this.alexa = new AlexaRemote({ context: this.context() }).setMaxListeners(32);
			this.attachAlexaHandlers();

      this.ui.smarthome      = JSON.stringify({ entityById: {}, colorNames: [], colorTemperatureNames: []});
      this.ui.devices        = JSON.stringify([]);
      this.ui.notifications  = JSON.stringify([]);
      this.ui.routines       = JSON.stringify([]);
      this.ui.musicProviders = JSON.stringify([]);
      this.ui.bluetooth      = JSON.stringify({});
      this.ui.errors         = JSON.stringify({});
      this.ui.skills         = JSON.stringify([]);

			this.errorMessages = {};

			this.setState('UNINITIALISED');
		};

		this.initAlexa = async function(input, ignoreFile = false) {
			if(this.initing)  {
				this.debugCb('Already initializing Alexa!');
				return;
			}
			this.initing = true;

			let config = {};
			tools.assign(config, ['proxyOwnIp', 'proxyPort', 'alexaServiceHost', 'pushDispatchHost', 'amazonPage', 'acceptLanguage', 'onKeywordInLanguage', 'userAgent', 'usePushConnection', 'autoQueryActivityOnTrigger'], this);
			if (this.authDebugEnabled) config.logger = this.authDebugLogger;
			config.refreshCookieInterval = 0;
			config.proxyLogLevel = 'warn';
			config.bluetooth = false;
			config.setupProxy = false;
			config.apiUserAgentPostfix = pjson.name + '/' + pjson.version;

			switch (this.authMethod) {
				case 'proxy':
					config.proxyOnly = true; // should not matter					

					const cookieData = tools.isObject(input) && input.loginCookie && tools.clone(input)
						 || this.cookieFile && !ignoreFile && await readFileAsync(this.cookieFile, 'utf8').then(json => JSON.parse(json)).catch(this.warnCb)
						 || undefined;

					this.authDebugWrite('account.init.cookieData.loaded', {
						ignoreFile,
						cookieFile: this.cookieFile,
						source: tools.isObject(input) && input.loginCookie ? 'input' : (this.cookieFile && !ignoreFile ? 'file-or-none' : 'none'),
						cookieData
					});

					config.cookie = cookieData;
					config.cookieJustCreated = !cookieData;

					// Prefer the marketplace from saved cookie data (set by
					// Amazon's getUserData) over the configured value.
					if (cookieData && cookieData.amazonPage && cookieData.amazonPage !== config.amazonPage) {
						this.warnCb(`amazonPage corrected: "${config.amazonPage}" -> "${cookieData.amazonPage}"`);
						config.amazonPage = cookieData.amazonPage;
					}
					break;
				case 'cookie':
					tools.assign(config, ['cookie'], this.credentials);
					config.cookieJustCreated = false;
					break;
				case 'password':
					tools.assign(config, ['email', 'password'], this.credentials);
					config.cookieJustCreated = false;
					break;
			}

			if (!config.amazonPageProxyLanguage) config.amazonPageProxyLanguage = config.acceptLanguage && config.acceptLanguage.replace('-', '_') || undefined;

			// guess authentication method that AlexaRemote will use
			// useful if we want to drive init by input
			// currently initType should not differ this.authMethod
			const initType = config.cookie ? (config.cookie.loginCookie ? 'proxy' : 'cookie') : (config.email && config.password ? 'password' : 'proxy');

			this.authDebugWrite('account.init.config.ready', {
				authMethod: this.authMethod,
				initType,
				proxyOwnIp: config.proxyOwnIp,
				proxyPort: config.proxyPort,
				amazonPage: config.amazonPage,
				acceptLanguage: config.acceptLanguage,
				cookieJustCreated: config.cookieJustCreated,
				cookie: config.cookie
			});

			this.resetAlexa();
			
			switch(initType) {
				case 'proxy': this.setState('INIT_PROXY'); break;
				case 'cookie': this.setState('INIT_COOKIE'); break;
				case 'password': this.setState('INIT_PASSWORD'); break;
			}

			this.logCb(`intialising ${this.name ? `"${this.name}" ` : ''}with the ${initType.toUpperCase()} method and ${config.cookie ? '' : 'NO '}saved data...`);

			this.debugCb(`Alexa-Remote: starting initialisation:`);
			this.debugCb(`Alexa-Remote: ${JSON.stringify({ authMethod: this.authMethod, initType: initType, cookie: this.authDebugShape(config.cookie, 0, 'cookie') })}`);

			// the this.alexa we init could change once the this.alexa.initExt is complete because
			// this.resetAlexa() or this.initAlexa() might have been called again during this time
			// so we need to check if this.alexa has changed and if so handle it differently
			const alexa = this.alexa;

			const proxyWaitCallback = (url) => {
				if(alexa !== this.alexa) return;
				const text = `open ${url} in your browser`;
				this.warn(text);
				this.setState('WAIT_PROXY', text);
			};

			if(initType === 'proxy') {
				this.authDebugWrite('account.init.proxy.port.check', { proxyPort: config.proxyPort });
				await tools.portAvailable(config.proxyPort).then(() => {
					this.authDebugWrite('account.init.proxy.port.available', { proxyPort: config.proxyPort });
				}).catch(error => {
					if(error.code === 'EADDRINUSE') error.message = `port ${config.proxyPort} already in use`;
					this.authDebugWrite('account.init.proxy.port.error', { proxyPort: config.proxyPort, message: error && error.message, code: error && error.code });
					this.setState('ERROR', error.message);
					this.initing = false;
					throw error;
				});
			}

			this.authDebugWrite('account.init.initExt.start', { initType, proxyPort: config.proxyPort, amazonPage: config.amazonPage });
			const cookieData = await alexa.initExt(config, proxyWaitCallback, this.warnCb, this.errorCb).catch(error => {
				if(alexa !== this.alexa) return;
				this.authDebugWrite('account.init.initExt.error', { message: error && error.message, code: error && error.code, statusCode: error && error.statusCode });
				this.setState('ERROR', error && error.message);
				this.initing = false;
				throw error;
			});

			this.authDebugWrite('account.init.initExt.returned', { cookieData });

			// see above why
			if(alexa !== this.alexa) {
				this.initing = false;
				throw new Error('Initialisation was aborted!');
			}

			if(this.authMethod === 'proxy' && this.cookieFile) {
				this.persistCookieData();
			}
			
			await this.buildUiJson(false);

			this.alexa.on('change-device', _ => this.builders.devices().catch(this.warnCb));
			this.alexa.on('change-smarthome', _ => this.builders.smarthome().catch(this.warnCb));
			this.alexa.on('change-notification', _ => this.builders.notifications().catch(this.warnCb));

			// see above why
			if(alexa !== this.alexa) {
				this.initing = false;
				throw new Error('Initialisation was aborted!');
			}

			this.setState('READY');
			this.authDebugWrite('account.init.ready', { state: this.state, cookieData: this.alexa && this.alexa.cookieData });
			this.renewTimeout();
			this.initing = false;
			return cookieData;
		};
		this.refreshAlexa = async function() {
			if(this.state.code !== 'READY') throw new Error('account must be initialised before refreshing');
			this.authDebugWrite('account.refresh.start', { state: this.state, authMethod: this.authMethod, hasCookieFile: !!this.cookieFile, cookieData: this.alexa && this.alexa.cookieData });
			this.setState('REFRESH');

			let cookieData;
			if(this.authMethod === 'proxy'
					&& this.alexa
					&& tools.isObject(this.alexa.cookieData)
					&& this.alexa.cookieData.loginCookie) {
				cookieData = this.alexa.cookieData;
				this.authDebugWrite('account.refresh.usingRuntimeCookieData', { cookieData });
			}

			//return this.alexa.refreshExt().then(value => {
			return this.initAlexa(cookieData).then(value => {
				this.setState('READY');
				this.authDebugWrite('account.refresh.ready', { value, cookieData: this.alexa && this.alexa.cookieData });
				this.renewTimeout();
				return value;
			}).catch(error => {
				this.authDebugWrite('account.refresh.error', { message: error && error.message, code: error && error.code, statusCode: error && error.statusCode });
				this.setState('ERROR', error && error.message);
				this.renewTimeout();
				throw error;
			});
		};
		this.updateAlexa = async function() {
			if(this.state.code !== 'READY') throw new Error('account must be initialised before updating');
			this.setState('UPDATE');

			return this.alexa.updateExt().then(async value => {
				await this.buildUiJson(false);
				this.setState('READY');
				return value;
			}).catch(error => {
				this.setState('ERROR', error && error.message);
				throw error;
			});
		};

		this.on('close', function () {
			this.resetAlexa();
		});
		
		if(this.autoInit) {
			this.initAlexa(undefined).catch(this.errorCb);
		}
	}

	RED.nodes.registerType("alexa-remote-account", AlexaRemoteAccountNode, {
		credentials: {
			cookie: { type: 'text' },
			email: { type: 'text' },
			password: { type: 'password' },
		}
	});

	RED.httpAdmin.get('/alexa-remote-error-messages.json', RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'errors', 'Error Messages', req, res));
	RED.httpAdmin.get('/alexa-remote-skills.json',         RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'skills', 'Skills', req, res));
	RED.httpAdmin.get('/alexa-remote-routines.json',       RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'routines', 'Routines', req, res));
	RED.httpAdmin.get('/alexa-remote-musicProviders.json', RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'musicProviders', 'Music Providers', req, res));
	RED.httpAdmin.get('/alexa-remote-devices.json',        RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'devices', 'Devices', req, res));
	RED.httpAdmin.get('/alexa-remote-smarthome.json',      RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'smarthome', 'Smarthome Devices', req, res));
	RED.httpAdmin.get('/alexa-remote-bluetooth.json',      RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'bluetooth', 'Bluetooth Devices', req, res));
	RED.httpAdmin.get('/alexa-remote-notifications.json',  RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'notifications', 'Notifications', req, res));
	RED.httpAdmin.get('/alexa-remote-lists.json',          RED.auth.needsPermission('alexa-remote.read'), (req, res) => accountHttpResponse(RED, 'lists', 'Lists', req, res));

	// we request sounds on demand because they are per device
	RED.httpAdmin.get('/alexa-remote-sounds.json', RED.auth.needsPermission('alexa-remote.read'), (req, res) => {
		const account = RED.nodes.getNode(req.query.account);
		const device = req.query.device;
		const label = 'Sounds';

		if (!account) {
			res.writeHeader(400, { 'Content-Type': 'text/plain' });
			return res.end(`Could not load ${label}: Account not deployed!`);
		}

		if (account.state.code !== 'READY') {
			res.writeHeader(400, { 'Content-Type': 'text/plain' });
			return res.end(`Could not load ${label}: Account not initialised!`);
		}

		account.alexa.getSoundsExt(device).then(sounds => {
			const pairs = sounds.map(sound => [JSON.stringify(sound), sound.displayName]);
			res.writeHeader(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(pairs));
		}).catch(error => {
			res.writeHeader(400, { 'Content-Type': 'text/plain' });
			return res.end(`Could not load sounds: "${error}"`);
		});
	});
};

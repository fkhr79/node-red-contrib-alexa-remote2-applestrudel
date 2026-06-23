#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LOG_PATH = path.join(os.tmpdir(), 'applestrudel-auth-debug', 'authdbg.jsonl');

function usage() {
	return [
		'Usage: applestrudel-auth-debug-collect [--log <path>] [--out <dir>] [--no-tar]',
		'',
		'Creates a sanitized auth debug bundle from authdbg.jsonl.',
		'The default log path is APPLESTRUDEL_AUTH_DEBUG_LOG or:',
		`  ${DEFAULT_LOG_PATH}`,
	].join('\n');
}

function parseArgs(argv) {
	const args = {
		logPath: process.env.APPLESTRUDEL_AUTH_DEBUG_LOG || (process.env.APPLESTRUDEL_AUTH_DEBUG_DIR ? path.join(process.env.APPLESTRUDEL_AUTH_DEBUG_DIR, 'authdbg.jsonl') : ''),
		outputRoot: process.cwd(),
		createTar: true,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			args.help = true;
		}
		else if (arg === '--no-tar') {
			args.createTar = false;
		}
		else if (arg === '--log') {
			if (!argv[i + 1]) throw new Error('--log requires a path');
			args.logPath = argv[++i];
		}
		else if (arg === '--out') {
			if (!argv[i + 1]) throw new Error('--out requires a directory');
			args.outputRoot = argv[++i];
		}
		else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}

	if (!args.logPath) {
		args.logPath = DEFAULT_LOG_PATH;
	}

	return args;
}

function sensitiveKey(key) {
	const text = String(key || '');
	return /(loginCookie|localCookie|^cookie$|Cookie$|set-cookie|token|access_token|refresh_token|source_token|authorization|openid(?:\.|_|$)|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|^serial$|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)/i.test(text);
}

function maskJsonValue(value, key = '') {
	if (sensitiveKey(key)) return '[AUTHDBG_MASKED]';
	if (Array.isArray(value)) return value.map(item => maskJsonValue(item));
	if (value && typeof value === 'object') {
		const masked = {};
		for (const childKey of Object.keys(value)) masked[childKey] = maskJsonValue(value[childKey], childKey);
		return masked;
	}
	if (typeof value === 'string') return sanitizeText(value);
	return value;
}

function sanitizeJsonLine(line) {
	try {
		return JSON.stringify(maskJsonValue(JSON.parse(line)));
	}
	catch (_err) {
		return null;
	}
}

function sanitizeText(value) {
	return String(value).split(/\r?\n/).map(line => sanitizeJsonLine(line) || line).join('\n')
		.replace(/("(?:loginCookie|localCookie|cookie|Cookie|set-cookie|authorization|openid(?:\.[A-Za-z0-9_.-]+)?|authorization_code|accessToken|refreshToken|access_token|refresh_token|source_token|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|serial|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)"\s*:\s*)"([^"\\]|\\.)*"/gi, '$1"[AUTHDBG_MASKED]"')
		.replace(/((?:loginCookie|localCookie|Cookie|set-cookie|authorization|openid(?:\.[A-Za-z0-9_.-]+)?|authorization_code|accessToken|refreshToken|access_token|refresh_token|source_token|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|serial|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)\s*[:=]\s*)([^"'\n\r,;}]+)/gi, '$1[AUTHDBG_MASKED]')
		.replace(/\b(?:authorization_code|openid\.[A-Za-z0-9_.-]+|access_token|refresh_token|source_token|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|csrf|frc|map-md|macDms|deviceId|deviceSerial|deviceSerialNumber|serialNumber|serial|customerId|applianceId|entityId|email|cookieFile|verifier|password|secret|session)=([^;,&\s"'}]+)/gi, '[AUTHDBG_FIELD_MASKED]')
		.replace(/\b((?:session-id(?:-time)?|session-token|csm-hit|ubid-[A-Za-z0-9-]+|x-[A-Za-z0-9-]+|at-[A-Za-z0-9-]+|sess-at-[A-Za-z0-9-]+|lc-[A-Za-z0-9-]+|i18n-prefs))=([^;,&\s"'}]+)/gi, '$1=[AUTHDBG_MASKED]')
		.replace(/\b(Atza\|)[A-Za-z0-9._~+/=-]+/g, '$1[AUTHDBG_MASKED]')
		.replace(/\b(X-Amz-[A-Za-z0-9-]+)=([^;,&\s"'}]+)/gi, '$1=[AUTHDBG_MASKED]');
}

function countLines(text) {
	if (!text) return 0;
	return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function readPackageVersion() {
	try {
		const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
		return packageJson.version || null;
	} catch (_err) {
		return null;
	}
}

function createTarball(bundleDir) {
	const tarPath = `${bundleDir}.tar.gz`;
	const result = childProcess.spawnSync('tar', ['-czf', tarPath, '-C', path.dirname(bundleDir), path.basename(bundleDir)], {
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		return { created: false, path: null, error: (result.stderr || result.stdout || 'tar failed').trim() };
	}

	return { created: true, path: tarPath, error: null };
}

function collectAuthDebug(options) {
	const logPath = path.resolve(options.logPath);
	if (!fs.existsSync(logPath)) {
		throw new Error(`debug log not found: ${logPath}`);
	}

	const outputRoot = path.resolve(options.outputRoot);
	fs.mkdirSync(outputRoot, { recursive: true });

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const bundleDir = fs.mkdtempSync(path.join(outputRoot, `applestrudel-auth-debug-${stamp}-`));

	const rawLog = fs.readFileSync(logPath, 'utf8');
	const sanitizedLog = sanitizeText(rawLog);
	const logStat = fs.statSync(logPath);

	fs.writeFileSync(path.join(bundleDir, 'authdbg.jsonl'), sanitizedLog, 'utf8');

	const summary = {
		createdAt: new Date().toISOString(),
		tool: 'applestrudel-auth-debug-collect',
		packageVersion: readPackageVersion(),
		runtime: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
		},
		input: {
			logFileName: path.basename(logPath),
			logDirName: path.basename(path.dirname(logPath)),
			bytes: logStat.size,
			mtime: logStat.mtime.toISOString(),
			lineCount: countLines(rawLog),
		},
		output: {
			tarCreated: false,
			tarPath: null,
			tarError: null,
		},
	};

	fs.writeFileSync(path.join(bundleDir, 'README.txt'), [
		'Applestrudel auth debug bundle',
		'',
		'Files:',
		'- authdbg.jsonl: sanitized auth debug event log',
		'- summary.json: local runtime and log metadata without auth values',
		'',
		'Check authdbg.jsonl before sharing if your environment has additional local sensitivity requirements.',
		'',
	].join('\n'), 'utf8');

	if (options.createTar) {
		summary.output.tarCreated = true;
		summary.output.tarPath = `${path.basename(bundleDir)}.tar.gz`;
		fs.writeFileSync(path.join(bundleDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
		const tar = createTarball(bundleDir);
		if (!tar.created) {
			summary.output.tarCreated = false;
			summary.output.tarPath = null;
			summary.output.tarError = tar.error;
			fs.writeFileSync(path.join(bundleDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
		}
	}
	else {
		fs.writeFileSync(path.join(bundleDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
	}

	return { bundleDir, summary };
}

function main() {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.help) {
			console.log(usage());
			return;
		}

		const result = collectAuthDebug(options);
		console.log(`bundleDir=${result.bundleDir}`);
		if (result.summary.output.tarCreated) console.log(`tarFile=${path.join(path.dirname(result.bundleDir), result.summary.output.tarPath)}`);
		if (result.summary.output.tarError) console.error(`tarWarning=${result.summary.output.tarError}`);
	}
	catch (error) {
		console.error(error.message);
		console.error('');
		console.error(usage());
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}

module.exports = {
	collectAuthDebug,
	parseArgs,
	sanitizeText,
};

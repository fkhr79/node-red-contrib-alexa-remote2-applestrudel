const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const collectorPath = path.join(repoRoot, 'scripts', 'collect-auth-debug.js');
const packageJson = require('../package.json');
const { sanitizeText } = require('../scripts/collect-auth-debug');

function runCollector(args, options = {}) {
	return childProcess.spawnSync(process.execPath, [collectorPath, ...args], {
		cwd: repoRoot,
		env: Object.assign({}, process.env, options.env || {}),
		encoding: 'utf8',
	});
}

function testSanitizeTextMasksLocalPathsWithoutMaskingUrls() {
	const cases = [
		{
			name: 'simple POSIX path',
			input: '/tmp/fake-sensitive-token.jsonl keep-simple-posix',
			absent: ['fake-sensitive-token'],
			present: ['[AUTHDBG_PATH_MASKED]', 'keep-simple-posix'],
		},
		{
			name: 'deep POSIX path',
			input: '/var/lib/node-red/secret-var-user/auth/cookie.json keep-deep-posix',
			absent: ['secret-var-user', 'cookie.json'],
			present: ['[AUTHDBG_PATH_MASKED]', 'keep-deep-posix'],
		},
		{
			name: 'POSIX path with dots hyphens and underscores',
			input: '/opt/node-red/user_1/auth.debug/cookie-store_2026.jsonl keep-posix-characters',
			absent: ['user_1', 'auth.debug', 'cookie-store_2026'],
			present: ['[AUTHDBG_PATH_MASKED]', 'keep-posix-characters'],
		},
		{
			name: 'Windows drive path',
			input: 'C:\\Users\\secret-windows-user\\auth\\cookie.json keep-windows',
			absent: ['secret-windows-user'],
			present: ['[AUTHDBG_PATH_MASKED]', 'keep-windows'],
		},
		{
			name: 'UNC path',
			input: '\\\\secret-server\\secret-share\\auth\\cookie.json keep-unc',
			absent: ['secret-server', 'secret-share'],
			present: ['[AUTHDBG_PATH_MASKED]', 'keep-unc'],
		},
		{
			name: 'URL',
			input: 'https://example.invalid/static/file.json keep-url',
			absent: [],
			present: ['https://example.invalid/static/file.json', 'keep-url'],
		},
		{
			name: 'URL path',
			input: 'GET /ap/static/file.json keep-url-path',
			absent: [],
			present: ['/ap/static/file.json', 'keep-url-path'],
		},
		{
			name: 'harmless non-path text',
			input: 'visible text with ratio 1/2 and word/not/path keep-harmless',
			absent: [],
			present: ['visible text', '1/2', 'word/not/path', 'keep-harmless'],
		},
		{
			name: 'already masked path',
			input: '[AUTHDBG_PATH_MASKED] keep-already-masked',
			absent: [],
			present: ['[AUTHDBG_PATH_MASKED]', 'keep-already-masked'],
		},
	];

	for (const testCase of cases) {
		const sanitized = sanitizeText(testCase.input);
		for (const value of testCase.absent) {
			assert(!sanitized.includes(value), `${testCase.name} leaked ${value}: ${sanitized}`);
		}
		for (const value of testCase.present) {
			assert(sanitized.includes(value), `${testCase.name} lost ${value}: ${sanitized}`);
		}
	}
}

function testCollectorCreatesSanitizedBundle() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-test-'));
	const logPath = path.join(tempRoot, 'authdbg.jsonl');
	const outputRoot = path.join(tempRoot, 'out');

	fs.writeFileSync(logPath, [
		'{"line":"Cookie: session-id=1234567890; csrf=secret-csrf; at-main=secret-at-cookie for secret-free-mail@example.invalid at C:\\\\Users\\\\secret-free-user\\\\auth\\\\cookie.json"}',
		'{"pathMessage":"C:\\\\Users\\\\secret-free-user\\\\auth\\\\cookie.json keep-safe-after-path"}',
		'plain escaped C:\\\\Users\\\\secret-escaped-user\\\\auth\\\\cookie.json keep-safe-after-escaped-path',
		'plain slash windows C:/Users/secret-slash-user/auth/cookie.json keep-safe-after-slash-windows-path',
		'plain unc \\\\secret-server\\\\secret-share\\\\auth\\\\cookie.json keep-safe-after-unc-path',
		'{"spacedPathMessage":"C:\\\\Users\\\\secret free user\\\\auth\\\\cookie.json keep-safe-after-spaced-path"}',
		'{"posixPathMessage":"/home/secret-posix-user/auth/cookie.json keep-safe-after-posix-path"}',
		'{"macPathMessage":"/Users/secret-mac-user/auth/cookie.json keep-safe-after-mac-path"}',
		'{"dataPathMessage":"/data/secret-data-user/auth/cookie.json keep-safe-after-data-path"}',
		'{"configPathMessage":"/config/secret-config-user/auth/cookie.json keep-safe-after-config-path"}',
		'{"rootPathMessage":"/root/secret-root-user/.node-red/cookie.json keep-safe-after-root-path"}',
		'{"dockerPathMessage":"/var/lib/docker/volumes/secret-docker-user/_data/auth/cookie.json keep-safe-after-docker-path"}',
		'{"tmpPathMessage":"/tmp/applestrudel-auth-debug/secret-tmp-user/authdbg.jsonl keep-safe-after-tmp-path"}',
		'{"varLibPathMessage":"/var/lib/node-red/secret-var-lib-user/auth/cookie.json keep-safe-after-var-lib-path"}',
		'{"optPathMessage":"/opt/node-red/secret-opt-user/auth/cookie.json keep-safe-after-opt-path"}',
		'{"mntPathMessage":"/mnt/data/supervisor/homeassistant/secret-mnt-user/auth/cookie.json keep-safe-after-mnt-path"}',
		'{"haPathMessage":"/homeassistant/secret-ha-user/auth/cookie.json keep-safe-after-ha-path"}',
		'Cookie: foo=secret-foo-cookie; bar=secret-bar-cookie keep-safe-after-cookie-line',
		'AUTHDBG {"authorization":["Bearer secret-prefixed-bearer"],"safe":"visible-prefixed-json"}',
		'AUTHDBG {"details":{"safe":"visible-nested-prefixed-json"},"authorization":["Bearer secret-prefixed-nested-bearer"],"cookie":{"localCookie":"secret-prefixed-nested-cookie"}}',
		'{"details":{"authorization_code":"secret-code","code":"secret-json-code","state":"secret-json-state","refreshToken":"secret-refresh","macDms":"secret-macdms","cookieFile":"C:\\\\Users\\\\secret-user\\\\auth\\\\cookie.json","email":"secret-mail@example.invalid","customerId":"secret-customer","serialNumber":"secret-serial-number","deviceSerialNumber":"secret-device-serial-number","applianceId":"secret-appliance","entityId":"secret-entity","safe":"visible"}}',
		'{"headers":{"authorization":["Bearer nested-secret"],"set-cookie":["session-id=nested-session; csrf=nested-csrf"]}}',
		'{"url":"http://127.0.0.1:3456/www.amazon.de/ap/maplanding?openid.claimed_id=https%3A%2F%2Fwww.amazon.de%2Fap%2Fid%2Famzn1.account.secret-account&openid.identity=secret-identity&openid.sig=secret-openid-signature&openid.response_nonce=secret-nonce&serial=secret-serial&code=secret-code&state=secret-state&customerId=secret-customer-url&deviceSerialNumber=secret-device-url&email=secret-mail-url%40example.invalid&safe=visible-url-safe&note=secret-note-mail%40example.invalid"}',
		'plain Atza|SECRETACCESS X-Amz-Signature=abcdef123456',
	].join('\n'), 'utf8');

	const result = runCollector(['--log', logPath, '--out', outputRoot, '--no-tar']);

	assert.strictEqual(result.status, 0, result.stderr || result.stdout);

	const match = result.stdout.match(/bundleDir=(.+)/);
	assert(match, `collector did not print bundleDir: ${result.stdout}`);

	const bundleDir = match[1].trim();
	const bundleLog = fs.readFileSync(path.join(bundleDir, 'authdbg.jsonl'), 'utf8');
	const summary = JSON.parse(fs.readFileSync(path.join(bundleDir, 'summary.json'), 'utf8'));
	const readme = fs.readFileSync(path.join(bundleDir, 'README.txt'), 'utf8');

	assert(!bundleLog.includes('secret-csrf'), 'csrf value leaked');
	assert(!bundleLog.includes('secret-at-cookie'), 'cookie value leaked');
	assert(!bundleLog.includes('secret-code'), 'authorization code leaked');
	assert(!bundleLog.includes('secret-state'), 'state query leaked');
	assert(!bundleLog.includes('secret-refresh'), 'refresh token leaked');
	assert(!bundleLog.includes('secret-macdms'), 'macDms value leaked');
	assert(!bundleLog.includes('nested-secret'), 'nested authorization value leaked');
	assert(!bundleLog.includes('nested-session'), 'nested session value leaked');
	assert(!bundleLog.includes('nested-csrf'), 'nested csrf value leaked');
	assert(!bundleLog.includes('secret-account'), 'OpenID claimed id leaked');
	assert(!bundleLog.includes('secret-identity'), 'OpenID identity leaked');
	assert(!bundleLog.includes('secret-openid-signature'), 'OpenID signature leaked');
	assert(!bundleLog.includes('secret-nonce'), 'OpenID response nonce leaked');
	assert(!bundleLog.includes('secret-serial'), 'serial value leaked');
	assert(!bundleLog.includes('secret-user'), 'cookie file path leaked');
	assert(!bundleLog.includes('secret-free-user'), 'free text path leaked');
	assert(!bundleLog.includes('secret-escaped-user'), 'escaped free text path leaked');
	assert(!bundleLog.includes('secret-slash-user'), 'slash Windows free text path leaked');
	assert(!bundleLog.includes('secret-server'), 'UNC server leaked');
	assert(!bundleLog.includes('secret-share'), 'UNC share leaked');
	assert(!bundleLog.includes('secret free user'), 'free text path with spaces leaked');
	assert(!bundleLog.includes('secret-posix-user'), 'POSIX free text path leaked');
	assert(!bundleLog.includes('secret-mac-user'), 'macOS free text path leaked');
	assert(!bundleLog.includes('secret-data-user'), 'data directory free text path leaked');
	assert(!bundleLog.includes('secret-config-user'), 'config directory free text path leaked');
	assert(!bundleLog.includes('secret-root-user'), 'root directory free text path leaked');
	assert(!bundleLog.includes('secret-docker-user'), 'docker volume free text path leaked');
	assert(!bundleLog.includes('secret-tmp-user'), 'tmp free text path leaked');
	assert(!bundleLog.includes('secret-var-lib-user'), 'var lib free text path leaked');
	assert(!bundleLog.includes('secret-opt-user'), 'opt free text path leaked');
	assert(!bundleLog.includes('secret-mnt-user'), 'mnt data free text path leaked');
	assert(!bundleLog.includes('secret-ha-user'), 'homeassistant free text path leaked');
	assert(!bundleLog.includes('secret-foo-cookie'), 'unknown cookie value leaked');
	assert(!bundleLog.includes('secret-bar-cookie'), 'second unknown cookie value leaked');
	assert(!bundleLog.includes('secret-prefixed-bearer'), 'prefixed JSON authorization array leaked');
	assert(!bundleLog.includes('secret-prefixed-nested-bearer'), 'nested prefixed JSON authorization array leaked');
	assert(!bundleLog.includes('secret-prefixed-nested-cookie'), 'nested prefixed JSON cookie object leaked');
	assert(!bundleLog.includes('secret-mail'), 'email value leaked');
	assert(!bundleLog.includes('secret-note-mail'), 'URL-encoded email in non-sensitive query parameter leaked');
	assert(!bundleLog.includes('secret-free-mail'), 'free text email leaked');
	assert(!bundleLog.includes('secret-customer'), 'customer id leaked');
	assert(!bundleLog.includes('secret-device'), 'device id leaked');
	assert(!bundleLog.includes('secret-serial-number'), 'serial number leaked');
	assert(!bundleLog.includes('secret-appliance'), 'appliance id leaked');
	assert(!bundleLog.includes('secret-entity'), 'entity id leaked');
	assert(!bundleLog.includes('secret-json-code'), 'JSON code value leaked');
	assert(!bundleLog.includes('secret-json-state'), 'JSON state value leaked');
	assert(!bundleLog.includes('SECRETACCESS'), 'Atza token leaked');
	assert(!bundleLog.includes('abcdef123456'), 'AWS signature leaked');
	assert(bundleLog.includes('visible'), 'safe field should remain visible');
	assert(bundleLog.includes('visible-url-safe'), 'safe URL query value should remain visible');
	assert(bundleLog.includes('keep-safe-after-path'), 'safe text after masked path should remain visible');
	assert(bundleLog.includes('keep-safe-after-escaped-path'), 'safe text after masked escaped path should remain visible');
	assert(bundleLog.includes('keep-safe-after-slash-windows-path'), 'safe text after masked slash Windows path should remain visible');
	assert(bundleLog.includes('keep-safe-after-unc-path'), 'safe text after masked UNC path should remain visible');
	assert(bundleLog.includes('keep-safe-after-spaced-path'), 'safe text after masked path with spaces should remain visible');
	assert(bundleLog.includes('keep-safe-after-posix-path'), 'safe text after masked POSIX path should remain visible');
	assert(bundleLog.includes('keep-safe-after-mac-path'), 'safe text after masked macOS path should remain visible');
	assert(bundleLog.includes('keep-safe-after-data-path'), 'safe text after masked data path should remain visible');
	assert(bundleLog.includes('keep-safe-after-config-path'), 'safe text after masked config path should remain visible');
	assert(bundleLog.includes('keep-safe-after-root-path'), 'safe text after masked root path should remain visible');
	assert(bundleLog.includes('keep-safe-after-docker-path'), 'safe text after masked docker path should remain visible');
	assert(bundleLog.includes('keep-safe-after-tmp-path'), 'safe text after masked tmp path should remain visible');
	assert(bundleLog.includes('keep-safe-after-var-lib-path'), 'safe text after masked var lib path should remain visible');
	assert(bundleLog.includes('keep-safe-after-opt-path'), 'safe text after masked opt path should remain visible');
	assert(bundleLog.includes('keep-safe-after-mnt-path'), 'safe text after masked mnt path should remain visible');
	assert(bundleLog.includes('keep-safe-after-ha-path'), 'safe text after masked homeassistant path should remain visible');
	assert(bundleLog.includes('keep-safe-after-cookie-line'), 'safe text after masked cookie line should remain visible');
	assert(bundleLog.includes('visible-prefixed-json'), 'safe prefixed JSON value should remain visible');
	assert(bundleLog.includes('visible-nested-prefixed-json'), 'safe nested prefixed JSON value should remain visible');
	assert.strictEqual(summary.input.logFileName, 'authdbg.jsonl');
	assert.strictEqual(summary.input.lineCount, 24);
	assert.strictEqual(summary.output.tarCreated, false);
	assert(readme.includes('authdbg.jsonl'));
}

function testCollectorUsesDebugDirEnvForDefaultLog() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-env-test-'));
	const logDir = path.join(tempRoot, 'custom-debug-dir');
	const outputRoot = path.join(tempRoot, 'out');
	fs.mkdirSync(logDir, { recursive: true });
	fs.writeFileSync(path.join(logDir, 'authdbg.jsonl'), '{"safe":"visible"}\n', 'utf8');

	const result = runCollector(['--out', outputRoot, '--no-tar'], {
		env: {
			APPLESTRUDEL_AUTH_DEBUG_LOG: '',
			APPLESTRUDEL_AUTH_DEBUG_DIR: logDir,
		},
	});

	assert.strictEqual(result.status, 0, result.stderr || result.stdout);
	const match = result.stdout.match(/bundleDir=(.+)/);
	assert(match, `collector did not print bundleDir: ${result.stdout}`);
	const summary = JSON.parse(fs.readFileSync(path.join(match[1].trim(), 'summary.json'), 'utf8'));
	assert.strictEqual(summary.input.logDirName, '[AUTHDBG_PATH_BASENAME_MASKED]');
}

function testCollectorMasksSummaryPathMetadata() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-summary-test-'));
	const logDir = path.join(tempRoot, 'secret-summary-mail@example.invalid');
	const logPath = path.join(logDir, 'secret-device-summary.jsonl');
	const outputRoot = path.join(tempRoot, 'out');
	fs.mkdirSync(logDir, { recursive: true });
	fs.writeFileSync(logPath, '{"safe":"visible"}\n', 'utf8');

	const result = runCollector(['--log', logPath, '--out', outputRoot, '--no-tar']);

	assert.strictEqual(result.status, 0, result.stderr || result.stdout);
	const match = result.stdout.match(/bundleDir=(.+)/);
	assert(match, `collector did not print bundleDir: ${result.stdout}`);
	const summaryText = fs.readFileSync(path.join(match[1].trim(), 'summary.json'), 'utf8');
	const summary = JSON.parse(summaryText);

	assert(!summaryText.includes('secret-summary-mail'), 'summary leaked custom log directory name');
	assert(!summaryText.includes('secret-device-summary'), 'summary leaked custom log file name');
	assert.strictEqual(summary.input.logFileName, '[AUTHDBG_PATH_BASENAME_MASKED]');
	assert.strictEqual(summary.input.logDirName, '[AUTHDBG_PATH_BASENAME_MASKED]');
}

function testCollectorCreatesTarArchiveByDefault() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-tar-test-'));
	const logPath = path.join(tempRoot, 'authdbg.jsonl');
	fs.writeFileSync(logPath, '{"safe":"visible"}\n', 'utf8');

	const result = runCollector(['--log', logPath, '--out', tempRoot]);

	assert.strictEqual(result.status, 0, result.stderr || result.stdout);
	const tarMatch = result.stdout.match(/tarFile=(.+)/);
	if (!tarMatch) {
		assert(result.stderr.includes('tarWarning='), result.stderr || result.stdout);
		return;
	}

	const tarFile = tarMatch[1].trim();
	assert(fs.existsSync(tarFile), `tar archive missing: ${tarFile}`);

	const listResult = childProcess.spawnSync('tar', ['-tzf', tarFile], { encoding: 'utf8' });
	assert.strictEqual(listResult.status, 0, listResult.stderr || listResult.stdout);
	assert(listResult.stdout.includes('authdbg.jsonl'), listResult.stdout);
	assert(listResult.stdout.includes('summary.json'), listResult.stdout);
	assert(listResult.stdout.includes('README.txt'), listResult.stdout);
}

function testCollectorSanitizesTarErrors() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-tar-error-test-'));
	const logPath = path.join(tempRoot, 'authdbg.jsonl');
	fs.writeFileSync(logPath, '{"safe":"visible"}\n', 'utf8');

	const originalSpawnSync = childProcess.spawnSync;
	try {
		childProcess.spawnSync = () => ({
			status: 1,
			stderr: 'tar failed at C:\\Users\\secret-tar-user\\auth\\bundle',
			stdout: '',
		});

		delete require.cache[collectorPath];
		const { collectAuthDebug } = require(collectorPath);
		const result = collectAuthDebug({ logPath, outputRoot: tempRoot, createTar: true });
		const summaryText = fs.readFileSync(path.join(result.bundleDir, 'summary.json'), 'utf8');
		const summary = JSON.parse(summaryText);

		assert(!summaryText.includes('secret-tar-user'), 'summary leaked tar error path');
		assert(summary.output.tarError.includes('[AUTHDBG_PATH_MASKED]'), summary.output.tarError);
	}
	finally {
		childProcess.spawnSync = originalSpawnSync;
		delete require.cache[collectorPath];
	}
}

function testPackageBinPointsToExecutableCollector() {
	const binPath = packageJson.bin && packageJson.bin['applestrudel-auth-debug-collect'];
	assert.strictEqual(binPath, 'scripts/collect-auth-debug.js');

	const scriptPath = path.join(repoRoot, binPath);
	const script = fs.readFileSync(scriptPath, 'utf8');
	assert(script.startsWith('#!/usr/bin/env node'), 'collector script is missing node shebang');
}

function testCollectorFailsCleanlyWhenLogMissing() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-missing-test-'));
	const result = runCollector(['--log', path.join(tempRoot, 'secret-missing-user', 'missing.jsonl'), '--out', tempRoot, '--no-tar']);

	assert.notStrictEqual(result.status, 0);
	assert(result.stderr.includes('debug log not found'), result.stderr);
	assert(!result.stderr.includes('secret-missing-user'), 'missing log error leaked full path');
	assert(result.stderr.includes('[AUTHDBG_PATH_MASKED]'), result.stderr);
}

testSanitizeTextMasksLocalPathsWithoutMaskingUrls();
testCollectorCreatesSanitizedBundle();
testCollectorUsesDebugDirEnvForDefaultLog();
testCollectorMasksSummaryPathMetadata();
testCollectorCreatesTarArchiveByDefault();
testCollectorSanitizesTarErrors();
testPackageBinPointsToExecutableCollector();
testCollectorFailsCleanlyWhenLogMissing();
console.log('auth-debug-collector tests passed');

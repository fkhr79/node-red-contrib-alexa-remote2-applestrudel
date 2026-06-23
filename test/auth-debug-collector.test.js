const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const collectorPath = path.join(repoRoot, 'scripts', 'collect-auth-debug.js');
const packageJson = require('../package.json');

function runCollector(args, options = {}) {
	return childProcess.spawnSync(process.execPath, [collectorPath, ...args], {
		cwd: repoRoot,
		env: Object.assign({}, process.env, options.env || {}),
		encoding: 'utf8',
	});
}

function testCollectorCreatesSanitizedBundle() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-test-'));
	const logPath = path.join(tempRoot, 'authdbg.jsonl');
	const outputRoot = path.join(tempRoot, 'out');

	fs.writeFileSync(logPath, [
		'{"line":"Cookie: session-id=1234567890; csrf=secret-csrf; at-main=secret-at-cookie"}',
		'{"details":{"authorization_code":"secret-code","refreshToken":"secret-refresh","macDms":"secret-macdms","safe":"visible"}}',
		'{"headers":{"authorization":["Bearer nested-secret"],"set-cookie":["session-id=nested-session; csrf=nested-csrf"]}}',
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
	assert(!bundleLog.includes('secret-refresh'), 'refresh token leaked');
	assert(!bundleLog.includes('secret-macdms'), 'macDms value leaked');
	assert(!bundleLog.includes('nested-secret'), 'nested authorization value leaked');
	assert(!bundleLog.includes('nested-session'), 'nested session value leaked');
	assert(!bundleLog.includes('nested-csrf'), 'nested csrf value leaked');
	assert(!bundleLog.includes('SECRETACCESS'), 'Atza token leaked');
	assert(!bundleLog.includes('abcdef123456'), 'AWS signature leaked');
	assert(bundleLog.includes('visible'), 'safe field should remain visible');
	assert.strictEqual(summary.input.logFileName, 'authdbg.jsonl');
	assert.strictEqual(summary.input.lineCount, 4);
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
	assert.strictEqual(summary.input.logDirName, path.basename(logDir));
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

function testPackageBinPointsToExecutableCollector() {
	const binPath = packageJson.bin && packageJson.bin['applestrudel-auth-debug-collect'];
	assert.strictEqual(binPath, 'scripts/collect-auth-debug.js');

	const scriptPath = path.join(repoRoot, binPath);
	const script = fs.readFileSync(scriptPath, 'utf8');
	assert(script.startsWith('#!/usr/bin/env node'), 'collector script is missing node shebang');
}

function testCollectorFailsCleanlyWhenLogMissing() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-missing-test-'));
	const result = runCollector(['--log', path.join(tempRoot, 'missing.jsonl'), '--out', tempRoot, '--no-tar']);

	assert.notStrictEqual(result.status, 0);
	assert(result.stderr.includes('debug log not found'), result.stderr);
}

testCollectorCreatesSanitizedBundle();
testCollectorUsesDebugDirEnvForDefaultLog();
testCollectorCreatesTarArchiveByDefault();
testPackageBinPointsToExecutableCollector();
testCollectorFailsCleanlyWhenLogMissing();
console.log('auth-debug-collector tests passed');

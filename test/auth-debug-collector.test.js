const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const collectorPath = path.join(repoRoot, 'scripts', 'collect-auth-debug.js');

function runCollector(args) {
	return childProcess.spawnSync(process.execPath, [collectorPath, ...args], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
}

function testCollectorCreatesSanitizedBundle() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-test-'));
	const logPath = path.join(tempRoot, 'authdbg.jsonl');
	const outputRoot = path.join(tempRoot, 'out');

	fs.writeFileSync(logPath, [
		'{"line":"Cookie: session-id=1234567890; csrf=secret-csrf; at-main=secret-at-cookie"}',
		'{"details":{"authorization_code":"secret-code","refreshToken":"secret-refresh","safe":"visible"}}',
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
	assert(!bundleLog.includes('SECRETACCESS'), 'Atza token leaked');
	assert(!bundleLog.includes('abcdef123456'), 'AWS signature leaked');
	assert(bundleLog.includes('visible'), 'safe field should remain visible');
	assert.strictEqual(summary.input.logFileName, 'authdbg.jsonl');
	assert.strictEqual(summary.input.lineCount, 3);
	assert.strictEqual(summary.output.tarCreated, false);
	assert(readme.includes('authdbg.jsonl'));
}

function testCollectorFailsCleanlyWhenLogMissing() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-debug-collector-missing-test-'));
	const result = runCollector(['--log', path.join(tempRoot, 'missing.jsonl'), '--out', tempRoot, '--no-tar']);

	assert.notStrictEqual(result.status, 0);
	assert(result.stderr.includes('debug log not found'), result.stderr);
}

testCollectorCreatesSanitizedBundle();
testCollectorFailsCleanlyWhenLogMissing();
console.log('auth-debug-collector tests passed');

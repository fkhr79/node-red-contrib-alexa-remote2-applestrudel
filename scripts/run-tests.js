#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const testDir = path.join(repoRoot, 'test');
const tests = fs.readdirSync(testDir)
	.filter(name => name.endsWith('.test.js'))
	.sort();

for (const test of tests) {
	const testPath = path.join(testDir, test);
	console.log(`RUN ${test}`);
	const result = childProcess.spawnSync(process.execPath, [testPath], {
		cwd: repoRoot,
		stdio: 'inherit',
	});

	if (result.status !== 0) {
		process.exit(result.status || 1);
	}
}

console.log('all node tests passed');

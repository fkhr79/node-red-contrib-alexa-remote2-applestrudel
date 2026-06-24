const assert = require('assert');
const fs = require('fs');
const path = require('path');

const docs = fs.readFileSync(path.join(__dirname, '..', 'AUTH_DEBUG.md'), 'utf8');
const codeBlocks = Array.from(docs.matchAll(/```(?:sh|powershell)\r?\n([\s\S]*?)```/g), match => match[1]);
const installCommands = [];

for (const block of codeBlocks) {
	const lines = block.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (!/npm(?:\.cmd)?\s+install\s+--save/.test(lines[i])) continue;
		const command = [lines[i]];
		while (/[\\`]$/.test(lines[i].trim()) && i + 1 < lines.length) {
			i++;
			command.push(lines[i]);
		}
		installCommands.push(command.join('\n'));
	}
}

assert(installCommands.length >= 2, 'AUTH_DEBUG.md should document Linux and Windows debug install commands');

for (const command of installCommands) {
	assert(
		!command.includes('fkhr79/alexa-cookie/archive/refs/heads'),
		'alexa-cookie2 debug tarball must be configured as an override, not installed as a direct dependency',
	);
}

assert(
	docs.includes('overrides.alexa-cookie2=https://github.com/fkhr79/alexa-cookie/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz'),
	'AUTH_DEBUG.md should configure alexa-cookie2 through npm overrides',
);

assert(
	docs.includes('node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/auth-debug-5.1.0.tar.gz'),
	'AUTH_DEBUG.md should install the 5.1.0-based Applestrudel debug branch',
);

assert(
	!docs.includes('node-red-contrib-alexa-remote2-applestrudel/archive/refs/heads/test/cumulative-auth-fixes-debug.tar.gz'),
	'AUTH_DEBUG.md should not tell users to install the old cumulative debug branch',
);

console.log('auth-debug-docs tests passed');

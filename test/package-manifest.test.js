const assert = require('assert');
const packageJson = require('../package.json');

const packageName = packageJson.name;
const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

for (const group of dependencyGroups) {
	const dependencies = packageJson[group] || {};

	assert(
		!Object.prototype.hasOwnProperty.call(dependencies, packageName),
		`${group} must not include ${packageName} as a self dependency`,
	);

	for (const [name, spec] of Object.entries(dependencies)) {
		assert(
			typeof spec !== 'string' || !spec.startsWith('file:'),
			`${group}.${name} must not use a local file: dependency in the package manifest`,
		);
	}
}

assert(
	!Object.prototype.hasOwnProperty.call(packageJson, 'overrides'),
	'package manifest must not contain root npm overrides; debug installs configure overrides in the Node-RED project',
);

console.log('package-manifest tests passed');

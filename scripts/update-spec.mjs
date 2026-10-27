// Pins a copy of MentionBird's /api/v1 OpenAPI spec and regenerates the node from it.
//
//   npm run spec:update                      # from the live API
//   npm run spec:update -- <url or file>     # from another server or a local copy
//   npm run spec:update -- --allow-removals  # pin a spec that drops operations or parameters

import { readFile, writeFile } from 'node:fs/promises';

import { generate, SPEC_PATH, specOperations } from './generate.mjs';

const LIVE_SPEC_URL = 'https://api.mentionbird.ai/api/v1/openapi.json';

const readSpec = async (source) => {
	if (!/^https?:\/\//.test(source)) {
		return JSON.parse(await readFile(source, 'utf8'));
	}
	const response = await fetch(source);
	if (!response.ok) {
		throw new Error(`GET ${source} returned ${response.status}`);
	}
	return await response.json();
};

const assertOpenApi3 = (spec, source) => {
	if (!String(spec.openapi ?? '').startsWith('3.') || typeof spec.paths !== 'object') {
		throw new Error(`${source} is not an OpenAPI 3 document`);
	}
	return spec;
};

const contractOf = (spec) =>
	new Map(
		specOperations(spec).map((operation) => [
			operation.operationId,
			operation.parameters.map((parameter) => `${parameter.in} parameter ${parameter.name}`),
		]),
	);

const removedFrom = (pinned, spec) => {
	const next = contractOf(spec);
	return [...contractOf(pinned)].flatMap(([operationId, parameters]) =>
		next.has(operationId)
			? parameters
					.filter((parameter) => !next.get(operationId).includes(parameter))
					.map((parameter) => `${operationId}: ${parameter}`)
			: [operationId],
	);
};

// /api/v1 only grows, so a spec that drops an operation or parameter is far more
// likely an older or broken deploy than a change the node should follow.
const assertNothingRemoved = (pinned, spec, source) => {
	const removed = removedFrom(pinned, spec);
	if (removed.length) {
		throw new Error(
			`${source} drops what the pinned spec has:\n  ${removed.join('\n  ')}\n` +
				'If that is intended, run again with --allow-removals.',
		);
	}
};

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith('--')) ?? LIVE_SPEC_URL;
// `servers` names whichever host the spec was fetched from; the node takes its
// address from the credential, so pinning it would only add noise to diffs.
const { servers, ...spec } = assertOpenApi3(await readSpec(source), source);
if (!args.includes('--allow-removals')) {
	assertNothingRemoved(JSON.parse(await readFile(SPEC_PATH, 'utf8')), spec, source);
}
await writeFile(SPEC_PATH, `${JSON.stringify(spec, null, '\t')}\n`);
console.log(`Pinned ${source} (spec version ${spec.info?.version}) to ${SPEC_PATH}`);
await generate();

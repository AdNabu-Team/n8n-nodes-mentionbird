// Pins a copy of MentionBird's /api/v1 OpenAPI spec and regenerates the node from it.
//
//   npm run spec:update                      # from the live API
//   npm run spec:update -- <url or file>     # from another server or a local copy

import { readFile, writeFile } from 'node:fs/promises';

import { generate, SPEC_PATH } from './generate.mjs';

const LIVE_SPEC_URL = 'https://app.mentionbird.ai/api/v1/openapi.json';

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

const source = process.argv[2] ?? LIVE_SPEC_URL;
// `servers` names whichever host the spec was fetched from; the node takes its
// address from the credential, so pinning it would only add noise to diffs.
const { servers, ...spec } = assertOpenApi3(await readSpec(source), source);
await writeFile(SPEC_PATH, `${JSON.stringify(spec, null, '\t')}\n`);
console.log(`Pinned ${source} (spec version ${spec.info?.version}) to ${SPEC_PATH}`);
await generate();

// Generates the node's resources, operations and parameters from the pinned
// /api/v1 OpenAPI spec, and the operations table in the README.
//
//   npm run generate

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

import * as layout from './layout.mjs';

const fromRoot = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const SPEC_PATH = fromRoot('openapi/mentionbird-api-v1.json');
const OUTPUT_PATH = fromRoot('nodes/MentionBird/generated/properties.ts');
const README_PATH = fromRoot('README.md');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const PAGING_PARAMETERS = ['limit', 'offset'];
// The page size for a list endpoint whose `limit` declares no maximum: the largest
// page every endpoint accepts (/ranking-advice rejects more than 50).
const DEFAULT_PAGE_SIZE = 50;
const ACRONYMS = { ai: 'AI', id: 'ID', llm: 'LLM', url: 'URL' };
const README_START = '<!-- operations:start -->';
const README_END = '<!-- operations:end -->';

const CODE = Symbol('code');
const code = (identifier) => ({ [CODE]: identifier });

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const titleCase = (name) =>
	name
		.split('_')
		.map((word) => ACRONYMS[word] ?? capitalize(word))
		.join(' ');
const camelCase = (name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const sentenceCase = (text) =>
	text
		.split(' ')
		.map((word, index) => (index === 0 || /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
		.join(' ');
const byName = (a, b) => a.name.localeCompare(b.name);

const assertSupported = (spec) => {
	if (JSON.stringify(spec).includes('"$ref"')) {
		throw new Error('The spec uses $ref, which the generator does not resolve yet.');
	}
	return spec;
};

const bodyParameters = (operation) => {
	const schema = operation.requestBody?.content?.['application/json']?.schema;
	const required = new Set(schema?.required ?? []);
	return Object.entries(schema?.properties ?? {}).map(([name, propertySchema]) => ({
		name,
		in: 'body',
		required: required.has(name),
		schema: propertySchema,
		description: propertySchema.description,
	}));
};

export const specOperations = (spec) =>
	Object.entries(spec.paths).flatMap(([path, item]) =>
		HTTP_METHODS.filter((method) => item[method]).map((method) => ({
			...item[method],
			path,
			method: method.toUpperCase(),
			parameters: [
				...(item.parameters ?? []),
				...(item[method].parameters ?? []),
				...bodyParameters(item[method]),
			],
		})),
	);

const assertParameterLocations = (operation) => {
	const unsupported = operation.parameters.filter(
		(parameter) => !['query', 'path', 'body'].includes(parameter.in),
	);
	if (unsupported.length) {
		const names = unsupported.map((parameter) => `${parameter.name} (in ${parameter.in})`);
		throw new Error(`${operation.operationId} has unsupported parameters: ${names.join(', ')}`);
	}
};

const resourceFor = (operation) => {
	const configured = layout.operations[operation.operationId]?.resource;
	const tagged = layout.resources.find((resource) =>
		resource.tags?.some((tag) => operation.tags?.includes(tag)),
	)?.value;
	const resource = configured ?? tagged;
	if (!resource) {
		throw new Error(
			`${operation.operationId} (tag ${operation.tags?.join(', ')}) has no n8n resource. ` +
				'Give it one in scripts/layout.mjs.',
		);
	}
	return resource;
};

const isPagingParameter = (parameter) =>
	parameter.in === 'query' && PAGING_PARAMETERS.includes(parameter.name);

const toOperationModel = (operation) => {
	assertParameterLocations(operation);
	const config = layout.operations[operation.operationId] ?? {};
	const paginated = operation.parameters.some(
		(parameter) => parameter.in === 'query' && parameter.name === 'offset',
	);
	const limit = operation.parameters.find(
		(parameter) => parameter.in === 'query' && parameter.name === 'limit',
	);
	return {
		id: operation.operationId,
		resource: resourceFor(operation),
		name: config.name ?? operation.summary,
		action: config.action ?? sentenceCase(operation.summary),
		description: operation.description ?? operation.summary,
		method: operation.method,
		path: operation.path,
		paginated,
		pageSize: limit?.schema?.maximum ?? DEFAULT_PAGE_SIZE,
		parameters: operation.parameters.filter(
			(parameter) => !(paginated && isPagingParameter(parameter)),
		),
		parameterOverrides: config.parameters ?? {},
	};
};

const configuredOrder = Object.keys(layout.operations);
const byConfiguredOrder = (a, b) => {
	const rank = (operation) => {
		const index = configuredOrder.indexOf(operation.id);
		return index === -1 ? configuredOrder.length : index;
	};
	return rank(a) - rank(b);
};

const settingsFor = (operation, parameter) => ({
	...layout.parameters[parameter.name],
	...operation.parameterOverrides[parameter.name],
});

const displayNameFor = (parameter, settings) => settings.displayName ?? titleCase(parameter.name);
const fieldNameFor = (parameter, settings) => settings.name ?? camelCase(parameter.name);

// Spec descriptions name other operations by operationId, and parameters by their
// snake_case name, sometimes in backticks. In n8n those read as
// "Resource → Operation" and the field's label.
const describerFor = (operations, resourceNames) => {
	const operationLabels = new Map(
		operations.map((operation) => [
			operation.id,
			`${resourceNames.get(operation.resource)} → ${operation.name}`,
		]),
	);
	const parameterLabels = new Map(
		operations
			.flatMap((operation) => operation.parameters)
			.map((parameter) => [
				parameter.name,
				displayNameFor(parameter, layout.parameters[parameter.name] ?? {}),
			]),
	);
	// An empty alternation would match at every word boundary.
	const replaceWords = (names, replacement) => (text) =>
		names.length ? text.replace(new RegExp(`\\b(${names.join('|')})\\b`, 'g'), replacement) : text;
	const replaceOperationIds = replaceWords([...operationLabels.keys()], (id) =>
		operationLabels.get(id),
	);
	const replaceParameterNames = replaceWords(
		[...parameterLabels.keys()].filter((name) => name.includes('_')),
		(name) => `'${parameterLabels.get(name)}'`,
	);
	return (text) => replaceParameterNames(replaceOperationIds(text).replace(/`([^`]+)`/g, '$1'));
};

const booleanDescription = (description) =>
	/^Whether\b/.test(description)
		? description
		: `Whether to ${description.charAt(0).toLowerCase()}${description.slice(1)}`;

// n8n's lint wants descriptions to start with a capital, encode angle brackets,
// and drop the final period of a single sentence (by its own definition below).
const isSingleSentence = (text) => text.replace('e.g.', '').split('. ').length === 1;
const n8nCopy = (text) => {
	const encoded = capitalize(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
	return isSingleSentence(encoded) ? encoded.replace(/\.$/, '') : encoded;
};

const EXPRESSION_LINK = '<a href="https://docs.n8n.io/code/expressions/">expression</a>';
const dynamicOptionsCopy = (multiple) =>
	multiple
		? {
				suffix: 'Names or IDs',
				description: `Choose from the list, or specify IDs using an ${EXPRESSION_LINK}`,
			}
		: {
				suffix: 'Name or ID',
				description: `Choose from the list, or specify an ID using an ${EXPRESSION_LINK}`,
			};

const trackedBrandLocator = (placeholder) => ({
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchBrands', searchable: true },
		},
		{
			displayName: 'By Name',
			name: 'name',
			type: 'string',
			placeholder: placeholder ?? 'e.g. Acme',
		},
	],
});

// A list field takes one entry per line, or an expression that returns an array.
const LIST_VALUE =
	'={{ (Array.isArray($value) ? $value : String($value).split("\\n")).map((entry) => String(entry).trim()).filter((entry) => entry) }}';

// The n8n field for one spec parameter: its type, default and how its value is sent.
const fieldFor = (parameter, settings, description) => {
	const { schema } = parameter;
	if (settings.locator === 'trackedBrand') {
		return { ...trackedBrandLocator(settings.placeholder), description };
	}
	if (settings.loadOptionsMethod) {
		const multiple = schema.type === 'array';
		const copy = dynamicOptionsCopy(multiple);
		return {
			displayNameSuffix: copy.suffix,
			type: multiple ? 'multiOptions' : 'options',
			typeOptions: { loadOptionsMethod: settings.loadOptionsMethod },
			default: multiple ? [] : '',
			exactDescription: copy.description,
		};
	}
	const values = schema.enum ?? schema.items?.enum;
	if (values && schema.type !== 'array') {
		const optionNames = settings.optionNames ?? {};
		return {
			type: 'options',
			options: values
				.map((value) => ({ name: optionNames[value] ?? titleCase(String(value)), value }))
				.sort(byName),
			default: settings.default ?? schema.default ?? values[0],
			description,
		};
	}
	if (schema.type === 'boolean') {
		return {
			type: 'boolean',
			default: settings.default ?? schema.default ?? false,
			description: settings.description ?? booleanDescription(description),
		};
	}
	if (schema.type === 'integer' || schema.type === 'number') {
		return { type: 'number', default: settings.default ?? schema.default ?? 0, description };
	}
	if (schema.type === 'array') {
		return {
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			description: `${description} One per line, or an expression that returns an array.`,
			sendValue: LIST_VALUE,
		};
	}
	return {
		type: 'string',
		default: settings.default ?? schema.default ?? '',
		description,
		placeholder: settings.placeholder,
	};
};

const propertyFor = (operation, parameter, describe) => {
	const settings = settingsFor(operation, parameter);
	const { sendValue, displayNameSuffix, exactDescription, ...field } = fieldFor(
		parameter,
		settings,
		settings.description ?? describe(parameter.description ?? ''),
	);
	const displayName = displayNameFor(parameter, settings);
	return {
		displayName: displayNameSuffix ? `${displayName} ${displayNameSuffix}` : displayName,
		name: fieldNameFor(parameter, settings),
		...field,
		description: exactDescription ?? n8nCopy(field.description),
		routing:
			parameter.in === 'path'
				? undefined
				: {
						send: {
							type: parameter.in === 'body' ? 'body' : 'query',
							property: parameter.name,
							value: sendValue,
						},
					},
	};
};

const pagingProperties = (show) => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, returnAll: [false] } },
	},
];

// Read by hooks.ts as 'options.output'. Offered on GETs that address no single
// record by path, which is where the API answers with lists.
const OUTPUT_OPTION = {
	displayName: 'Output',
	name: 'output',
	type: 'options',
	options: [
		{ name: 'One Item per Row', value: 'rows' },
		{ name: 'Whole Response', value: 'response' },
	],
	default: 'rows',
	description:
		"How to output a list: one item per row, or the whole response as one item, with the rows in 'items' next to the totals and summary fields. A response that isn't a list is always one item.",
};

const offersOutputOption = (operation) =>
	operation.method === 'GET' && !operation.parameters.some((parameter) => parameter.in === 'path');

const optionalCollection = (operation, properties, show) => {
	const [displayName, name, placeholder] =
		operation.method === 'GET'
			? ['Options', 'options', 'Add Option']
			: ['Additional Fields', 'additionalFields', 'Add Field'];
	return {
		displayName,
		name,
		type: 'collection',
		placeholder,
		default: {},
		displayOptions: { show },
		options: [...properties].sort((a, b) => a.displayName.localeCompare(b.displayName)),
	};
};

const parameterProperties = (operation, describe) => {
	const show = { resource: [operation.resource], operation: [operation.id] };
	const property = (parameter) => propertyFor(operation, parameter, describe);
	const required = operation.parameters
		.filter((parameter) => parameter.required || parameter.in === 'path')
		.map((parameter) => ({ ...property(parameter), required: true, displayOptions: { show } }));
	const optional = [
		...operation.parameters
			.filter((parameter) => !parameter.required && parameter.in !== 'path')
			.map(property),
		...(offersOutputOption(operation) ? [OUTPUT_OPTION] : []),
	];
	return [
		...required,
		...(operation.paginated ? pagingProperties(show) : []),
		...(optional.length ? [optionalCollection(operation, optional, show)] : []),
	];
};

const urlFor = (operation) => {
	const fieldName = (name) => {
		const parameter = operation.parameters.find((candidate) => candidate.name === name);
		return fieldNameFor(parameter, settingsFor(operation, parameter));
	};
	return operation.path.includes('{')
		? `=${operation.path.replace(/\{([^}]+)\}/g, (_, name) => `{{ encodeURIComponent($parameter["${fieldName(name)}"]) }}`)}`
		: operation.path;
};

const operationOption = (operation, describe) => ({
	name: operation.name,
	value: operation.id,
	action: operation.action,
	description: n8nCopy(describe(operation.description)),
	routing: {
		request: { method: operation.method, url: urlFor(operation) },
		send: operation.paginated ? { paginate: true } : undefined,
		operations: operation.paginated
			? { pagination: code(`paginateListEnvelope(${operation.pageSize})`) }
			: undefined,
		output: {
			postReceive: operation.paginated
				? [code('throwOnApiError')]
				: [code('throwOnApiError'), code('splitListEnvelope')],
		},
	},
});

const buildModel = (spec) => {
	const operations = specOperations(assertSupported(spec)).map(toOperationModel);
	const resourceNames = new Map(layout.resources.map(({ value, name }) => [value, name]));
	const describe = describerFor(operations, resourceNames);
	const resources = layout.resources
		.map((resource) => ({
			...resource,
			operations: operations
				.filter((operation) => operation.resource === resource.value)
				.sort(byConfiguredOrder),
		}))
		.filter((resource) => resource.operations.length);
	const missing = configuredOrder.filter(
		(id) => !operations.some((operation) => operation.id === id),
	);
	return { resources, describe, missing };
};

const toTs = (value) => {
	if (value?.[CODE]) {
		return value[CODE];
	}
	if (Array.isArray(value)) {
		return `[${value.map(toTs).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${toTs(entry)}`).join(',')}}`;
	}
	return JSON.stringify(value);
};

const renderProperties = ({ resources, describe }) => {
	const resourceProperty = {
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: resources.map(({ name, value }) => ({ name, value })).sort(byName),
		default: layout.defaultResource,
	};
	const operationProperties = resources.flatMap((resource) => [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [resource.value] } },
			options: resource.operations
				.map((operation) => operationOption(operation, describe))
				.sort(byName),
			default: resource.operations[0].id,
		},
		...resource.operations.flatMap((operation) => parameterProperties(operation, describe)),
	]);
	// The node's subtitle on the canvas: the selected operation's action.
	const actions = Object.fromEntries(
		resources.flatMap((resource) => resource.operations).map(({ id, action }) => [id, action]),
	);
	const subtitle = `={{ (${JSON.stringify(actions)})[$parameter["operation"]] }}`;
	return [
		'// Generated by `npm run generate` from openapi/mentionbird-api-v1.json.\n' +
			'// Change scripts/layout.mjs or scripts/generate.mjs instead of this file.',
		"import type { INodeProperties } from 'n8n-workflow';",
		"import { paginateListEnvelope, splitListEnvelope, throwOnApiError } from '../hooks';",
		`export const subtitle = ${toTs(subtitle)};`,
		`export const resourceProperty: INodeProperties = ${toTs(resourceProperty)};`,
		`export const operationProperties: INodeProperties[] = ${toTs(operationProperties)};`,
	].join('\n\n');
};

const escapeCell = (text) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

const renderOperationsTable = ({ resources, describe }) =>
	[
		'| Resource | Operation | What it does | Endpoint |',
		'| --- | --- | --- | --- |',
		...resources.flatMap((resource) =>
			resource.operations.map(
				(operation) =>
					`| ${resource.name} | ${operation.name} | ${escapeCell(describe(operation.description))} | \`${operation.method} /api/v1${operation.path}\` |`,
			),
		),
	].join('\n');

const replaceBetweenMarkers = (text, replacement) => {
	const start = text.indexOf(README_START);
	const end = text.indexOf(README_END);
	if (start === -1 || end === -1) {
		throw new Error(`README.md needs ${README_START} and ${README_END} markers.`);
	}
	return `${text.slice(0, start + README_START.length)}\n\n${replacement}\n\n${text.slice(end)}`;
};

const format = async (source, path) =>
	prettier.format(source, { ...(await prettier.resolveConfig(path)), filepath: path });

export const generate = async () => {
	const model = buildModel(JSON.parse(await readFile(SPEC_PATH, 'utf8')));
	await writeFile(OUTPUT_PATH, await format(renderProperties(model), OUTPUT_PATH));
	const readme = await readFile(README_PATH, 'utf8');
	await writeFile(
		README_PATH,
		await format(replaceBetweenMarkers(readme, renderOperationsTable(model)), README_PATH),
	);
	const count = model.resources.flatMap((resource) => resource.operations).length;
	console.log(`Generated ${count} operations in ${model.resources.length} resources.`);
	if (model.missing.length) {
		console.log(`Not in the spec yet, so skipped: ${model.missing.join(', ')}`);
	}
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await generate();
}

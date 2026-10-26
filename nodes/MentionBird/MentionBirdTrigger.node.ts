import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
	type NodeApiError,
	type WorkflowActivateMode,
} from 'n8n-workflow';

import { getAiPlatforms, searchBrands } from './methods';
import { CREDENTIAL_TYPE } from './transport';
import {
	pollRankingAdvice,
	pollVisibility,
	type ChangeDirection,
	type PollPurpose,
	type VisibilityComparison,
} from './triggerEvents';

// n8n polls every minute by default. Visibility changes once a day and a
// quarter-hour's delay on new ranking advice costs little, so the trigger calls
// the API no more often than this, failed checks included.
const MIN_CHECK_INTERVAL_MINUTES = 15;
// A scheduled poll can run a few milliseconds early, which would make Poll Times
// of exactly the interval skip every other check.
const CHECK_TOLERANCE_MS = 5_000;

// 'activate' is n8n's mode for turning a workflow on. Republishing an active
// workflow is 'update', and restarting n8n is 'init'; both keep the saved state.
const ACTIVATIONS: WorkflowActivateMode[] = ['activate', 'create'];

// n8n gives every poll of one activation the same context, so a context not seen
// before is that activation's first poll.
const startedActivations = new WeakSet<IPollFunctions>();

const pollPurpose = (context: IPollFunctions): PollPurpose => {
	if (context.getMode() === 'manual') {
		return 'sample';
	}
	const firstPoll = !startedActivations.has(context);
	startedActivations.add(context);
	return firstPoll && ACTIVATIONS.includes(context.getActivationMode()) ? 'baseline' : 'check';
};

const retryAfterMs = (error: unknown): number =>
	1000 * (Number((error as NodeApiError).context?.retryAfterSeconds) || 0);

const visibilitySettings = (context: IPollFunctions, brand: string) => {
	const options = context.getNodeParameter('options', {}) as IDataObject;
	return {
		brand,
		minimumChange: context.getNodeParameter('minimumChange', 5) as number,
		direction: context.getNodeParameter('direction', 'any') as ChangeDirection,
		compareWith: context.getNodeParameter('compareWith', 'previousDay') as VisibilityComparison,
		filters: Object.fromEntries(
			[
				['llm_provider', options.llmProvider],
				['query_tag', options.queryTag],
			].filter(([, value]) => value),
		),
	};
};

const showFor = (event: string) => ({ show: { event: [event] } });

export class MentionBirdTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MentionBird Trigger',
		name: 'mentionBirdTrigger',
		icon: { light: 'file:mentionbird.svg', dark: 'file:mentionbird.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{ ({ visibilityChanged: "Visibility changed", rankingAdviceReady: "New ranking advice" })[$parameter["event"]] }}',
		description:
			"Starts a workflow when a brand's visibility in AI answers changes or new ranking advice is ready on MentionBird",
		defaults: {
			name: 'MentionBird Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		properties: [
			{
				displayName: `MentionBird is checked at most once every ${MIN_CHECK_INTERVAL_MINUTES} minutes, whatever the poll times say, and a failed check waits as long. Visibility is compared once a day, from 04:00 UTC.`,
				name: 'checkFrequencyNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New Ranking Advice',
						value: 'rankingAdviceReady',
						description: "A ranking-advice run finished for one of the brand's prompts",
					},
					{
						name: 'Visibility Changed',
						value: 'visibilityChanged',
						description:
							"The brand's visibility on the last complete day moved by at least the minimum change",
					},
				],
				default: 'visibilityChanged',
			},
			{
				displayName: 'Brand',
				name: 'brand',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'Tracked brand name, exactly as MentionBird shows it',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'searchBrands', searchable: true },
					},
					{ displayName: 'By Name', name: 'name', type: 'string', placeholder: 'e.g. Acme' },
				],
			},
			{
				displayName: 'Minimum Change (Points)',
				name: 'minimumChange',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 1 },
				default: 5,
				description: 'How many percentage points visibility has to move to start the workflow',
				displayOptions: showFor('visibilityChanged'),
			},
			{
				displayName: 'Direction',
				name: 'direction',
				type: 'options',
				options: [
					{ name: 'Down', value: 'down' },
					{ name: 'Either Way', value: 'any' },
					{ name: 'Up', value: 'up' },
				],
				default: 'any',
				displayOptions: showFor('visibilityChanged'),
			},
			{
				displayName: 'Compare With',
				name: 'compareWith',
				type: 'options',
				options: [
					{
						name: "Previous 7 Days' Average",
						value: 'previousWeek',
						description: 'Steadier when the brand has few prompts and daily numbers jump',
					},
					{
						name: 'Previous Day',
						value: 'previousDay',
						description: 'The latest earlier day with AI answers',
					},
				],
				default: 'previousDay',
				displayOptions: showFor('visibilityChanged'),
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: showFor('visibilityChanged'),
				options: [
					{
						displayName: 'AI Platform Name or ID',
						name: 'llmProvider',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getAiPlatforms' },
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Prompt Tag',
						name: 'queryTag',
						type: 'string',
						default: '',
						description: "Only prompts with this tag's slug, from Prompt → Get Tags",
					},
				],
			},
		],
	};

	methods = {
		listSearch: { searchBrands },
		loadOptions: { getAiPlatforms },
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const purpose = pollPurpose(this);
		const brand = this.getNodeParameter('brand', '', { extractValue: true }) as string;
		const event = this.getNodeParameter('event') as string;
		const settings = visibilitySettings(this, brand);
		// New settings take effect at once rather than at the next scheduled check.
		const key = JSON.stringify([event, brand, settings.compareWith, settings.filters]);
		const state = this.getWorkflowStaticData('node');
		const next = state.nextCheck as { key: string; at: number } | undefined;
		const now = Date.now();
		if (purpose === 'check' && next?.key === key && now < next.at - CHECK_TOLERANCE_MS) {
			return null;
		}
		const nextAt = now + MIN_CHECK_INTERVAL_MINUTES * 60_000;
		if (purpose !== 'sample') {
			state.nextCheck = { key, at: nextAt };
		}

		const events = await (
			event === 'rankingAdviceReady'
				? pollRankingAdvice.call(this, brand, purpose)
				: pollVisibility.call(this, settings, purpose)
		).catch((error: unknown) => {
			if (purpose !== 'sample') {
				state.nextCheck = { key, at: Math.max(nextAt, now + retryAfterMs(error)) };
			}
			throw error;
		});
		return events.length ? [this.helpers.returnJsonArray(events)] : null;
	}
}

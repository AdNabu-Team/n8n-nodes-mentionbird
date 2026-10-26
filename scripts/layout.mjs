// How the spec's operations are laid out in n8n. Everything else (paths, methods,
// parameters, types, enums, defaults and descriptions) comes from the spec itself.
//
// An operation's resource is its entry in `operations`, or else the resource that
// claims its spec tag. Generation stops on an operation with neither, so a new tag
// gets a decision rather than a resource nobody chose.

export const resources = [
	{ value: 'aiPlatform', name: 'AI Platform' },
	{ value: 'answer', name: 'Answer', tags: ['Answers'] },
	{ value: 'brand', name: 'Brand' },
	{ value: 'citation', name: 'Citation', tags: ['Citations'] },
	{ value: 'prompt', name: 'Prompt', tags: ['Prompts'] },
	{ value: 'visibility', name: 'Visibility', tags: ['Visibility'] },
	{ value: 'webSearch', name: 'Web Search', tags: ['Searches'] },
	{ value: 'youTube', name: 'YouTube', tags: ['Video'] },
];

export const defaultResource = 'brand';

// Keyed by operationId. `name` and `action` follow n8n's UX guidelines; without
// them an operation falls back to the spec's summary. The first operation listed
// for a resource is its default. Entries for operations the spec doesn't have yet
// are skipped.
export const operations = {
	listTrackedBrands: {
		resource: 'brand',
		name: 'Get Many',
		action: 'Get many tracked brands',
	},
	addTrackedBrand: {
		resource: 'brand',
		name: 'Add',
		action: 'Add a tracked brand',
		// A new brand, so free text under its own field name rather than the picker's.
		parameters: {
			brand: {
				locator: null,
				name: 'brandName',
				displayName: 'Brand Name',
				placeholder: 'e.g. Acme',
			},
		},
	},
	listCompetitors: {
		resource: 'brand',
		name: 'Get Competitors',
		action: 'Get competitors of a brand',
	},

	listQueries: { resource: 'prompt', name: 'Get Many', action: 'Get many tracked prompts' },
	listQueryTags: { resource: 'prompt', name: 'Get Tags', action: 'Get prompt tags' },
	listPromptsByVisibility: {
		name: 'Get Many by Visibility',
		action: 'Get prompts ranked by visibility',
	},
	getPromptBrandLeaderboard: {
		name: 'Get Leaderboard',
		action: 'Get the brand leaderboard for a prompt',
	},
	getRankingAdvice: { name: 'Get Ranking Advice', action: 'Get ranking advice for a prompt' },
	listRankingAdvice: {
		name: 'Get Ranking Advice Runs',
		action: 'Get ranking advice runs across prompts',
	},
	addPrompts: { resource: 'prompt', name: 'Add', action: 'Add prompts to track' },

	listLLMProviders: {
		resource: 'aiPlatform',
		name: 'Get Many',
		action: 'Get many AI platforms',
	},

	getVisibility: { name: 'Get', action: 'Get brand visibility' },
	getTopMentionedBrands: { name: 'Get Share of Voice', action: 'Get share of voice' },

	listCitations: { name: 'Get Many', action: 'Get many citations' },
	getTopCitationDomains: { name: 'Get Top Domains', action: 'Get top cited domains' },
	getOwnedSourceShare: {
		name: 'Get Owned vs Earned Share',
		action: 'Get owned vs earned citation share',
	},
	getCitationBreakdown: { name: 'Get Breakdown', action: 'Get citation breakdown' },
	listCitationTags: { name: 'Get Taxonomy', action: 'Get citation taxonomy' },

	getTopWebSearches: { name: 'Get Many', action: 'Get many web searches' },

	listQueryRuns: { name: 'Get Many', action: 'Get many AI answers' },
	getQueryRun: { name: 'Get', action: 'Get an AI answer' },

	// n8n's lint requires sentence case in actions, which rules out "YouTube".
	listYouTubeSummaries: { name: 'Get Many', action: 'Get many video summaries' },
	getYouTubeSummary: { name: 'Get', action: 'Get a video summary' },
};

// Keyed by the spec's parameter name; an operation's own `parameters` override these.
//   name             n8n field name, when the camelCased spec name would clash
//   displayName      label, when the spec's name doesn't read well in n8n
//   locator          'trackedBrand' makes it a picker filled from Brand → Get Many
//   loadOptionsMethod  fills a list parameter from the API (see methods.ts)
//   optionNames      labels for enum values
//   description, placeholder, default   replace the spec's
export const parameters = {
	brand: { locator: 'trackedBrand' },
	brand_prompt_id: { displayName: 'Prompt ID' },
	query_tag: { displayName: 'Prompt Tag' },
	llm_provider: {
		displayName: 'AI Platform',
		optionNames: { openai: 'ChatGPT' },
	},
	llms: { displayName: 'AI Platform', loadOptionsMethod: 'getAiPlatforms' },
	group_by: { optionNames: { provider: 'AI Platform', query_tag: 'Prompt Tag' } },
	order: { optionNames: { asc: 'Ascending', desc: 'Descending' } },
	start_date: { placeholder: 'e.g. 2026-01-01' },
	end_date: { placeholder: 'e.g. 2026-01-31' },
	country: { placeholder: 'e.g. US' },
	domain: { placeholder: 'e.g. example.com' },
	url: {
		displayName: 'Video URL',
		placeholder: 'e.g. https://www.youtube.com/watch?v=aqz-KE-bpKQ',
	},
	run_id: { displayName: 'Answer ID' },
	mentioned: {
		description:
			'Whether to return only answers that name the brand (on) or only answers that omit it (off). Leave this option out to get both.',
	},
	window_days: { default: 30 },
	min_search_volume: { default: 1 },
	max_difficulty: { default: 10 },
};

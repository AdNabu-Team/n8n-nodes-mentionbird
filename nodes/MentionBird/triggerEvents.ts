import type { IDataObject, IPollFunctions } from 'n8n-workflow';

import { apiGet, type ListEnvelope } from './transport';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// The API counts days in UTC. A day counts as complete an hour after MentionBird's
// nightly 03:00 UTC pre-aggregation of visibility.
const SETTLE_HOURS = 4;

// Days of history behind the "previous 7 days" baseline, plus the day compared.
const VISIBILITY_WINDOW_DAYS = 8;
// How many missed days one check compares, after n8n or the API was down.
const MAX_CATCH_UP_DAYS = 7;

// The ranking-advice API's largest page, and how far one check reads.
const ADVICE_PAGE_SIZE = 50;
const MAX_ADVICE_PAGES = 4;
const MAX_REMEMBERED_RUNS = 500;

// What a poll is for: a manual test's sample, recording where things stand when
// the workflow is activated, or a scheduled check for new events.
export type PollPurpose = 'sample' | 'baseline' | 'check';

export type VisibilityComparison = 'previousDay' | 'previousWeek';
export type ChangeDirection = 'any' | 'down' | 'up';

export interface VisibilitySettings {
	brand: string;
	minimumChange: number;
	compareWith: VisibilityComparison;
	direction: ChangeDirection;
	filters: IDataObject;
}

interface DayRow extends IDataObject {
	date: string;
	visibility_pct: number;
	total_runs: number;
	mention_runs: number;
}

interface AdviceRun extends IDataObject {
	run_id: number;
}

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const addDays = (date: string, days: number): string => isoDate(Date.parse(date) + days * DAY_MS);

export const lastCompleteDay = (now: number): string =>
	isoDate(now - SETTLE_HOURS * HOUR_MS - DAY_MS);

// The days after `after`, through `through`, oldest first, at most MAX_CATCH_UP_DAYS.
const daysSince = (after: string, through: string): string[] => {
	const count = Math.min(
		Math.round((Date.parse(through) - Date.parse(after)) / DAY_MS),
		MAX_CATCH_UP_DAYS,
	);
	return Array.from({ length: Math.max(count, 0) }, (_, index) =>
		addDays(through, index + 1 - count),
	);
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

// A day against the day or week before it, counting only days with runs: a day
// without any is a crawl gap, not a drop to zero.
export const compareVisibility = (
	rows: DayRow[],
	day: string,
	compareWith: VisibilityComparison,
): { change: number; comparison: IDataObject } | undefined => {
	const windowStart = addDays(day, 1 - VISIBILITY_WINDOW_DAYS);
	const measured = rows.filter(
		(row) => row.total_runs > 0 && row.date >= windowStart && row.date <= day,
	);
	const latest = measured.find((row) => row.date === day);
	const earlier = measured.filter((row) => row.date < day);
	const baseline = compareWith === 'previousDay' ? earlier.slice(-1) : earlier;
	if (!latest || !baseline.length) {
		return undefined;
	}
	const sum = (key: 'mention_runs' | 'total_runs') =>
		baseline.reduce((total, row) => total + row[key], 0);
	const baselinePct = (100 * sum('mention_runs')) / sum('total_runs');
	const change = latest.visibility_pct - baselinePct;
	return {
		change,
		comparison: {
			...latest,
			baseline_visibility_pct: round1(baselinePct),
			baseline_start_date: baseline[0].date,
			baseline_end_date: baseline[baseline.length - 1].date,
			compared_with: compareWith === 'previousDay' ? 'previous_day' : 'previous_7_days',
			change_pts: round1(change),
			direction: change > 0 ? 'up' : change < 0 ? 'down' : 'none',
		},
	};
};

const crossesThreshold = (change: number, minimum: number, direction: ChangeDirection): boolean =>
	change !== 0 &&
	Math.abs(change) >= minimum &&
	{ any: true, down: change < 0, up: change > 0 }[direction];

// One request per check that has a new complete day to compare; a check on a day
// already compared costs nothing. Activating reads the latest day without
// comparing it, so bad settings fail the activation.
export async function pollVisibility(
	this: IPollFunctions,
	settings: VisibilitySettings,
	purpose: PollPurpose,
): Promise<IDataObject[]> {
	const state = this.getWorkflowStaticData('node');
	const key = JSON.stringify([settings.brand, settings.compareWith, settings.filters]);
	const day = lastCompleteDay(Date.now());
	const seen = state.visibility as { key: string; lastDay: string } | undefined;
	const lastDay = seen?.key === key ? seen.lastDay : undefined;
	const baseline = purpose === 'baseline' || (purpose === 'check' && lastDay === undefined);
	const days = purpose === 'check' && lastDay !== undefined ? daysSince(lastDay, day) : [day];
	if (!days.length) {
		return [];
	}
	const response = await apiGet<ListEnvelope<DayRow> & IDataObject>(this, '/visibility', {
		...settings.filters,
		brand: settings.brand,
		group_by: 'day',
		start_date: addDays(days[0], 1 - VISIBILITY_WINDOW_DAYS),
		end_date: day,
	});
	if (purpose !== 'sample') {
		state.visibility = { key, lastDay: day };
	}
	if (baseline) {
		return [];
	}
	return days.flatMap((date) => {
		const result = compareVisibility(response.items, date, settings.compareWith);
		return result &&
			(purpose === 'sample' ||
				crossesThreshold(result.change, settings.minimumChange, settings.direction))
			? [{ brand: settings.brand, ...result.comparison, filters_applied: response.filters_applied }]
			: [];
	});
}

// Runs come newest-started first, but a run can finish after runs started later,
// so the trigger remembers run IDs rather than a timestamp. Activating records the
// runs already there; a manual test returns the newest-started finished run.
export async function pollRankingAdvice(
	this: IPollFunctions,
	brand: string,
	purpose: PollPurpose,
): Promise<IDataObject[]> {
	const state = this.getWorkflowStaticData('node');
	const fetchPage = async (offset: number, limit = ADVICE_PAGE_SIZE) =>
		await apiGet<ListEnvelope<AdviceRun>>(this, '/ranking-advice', {
			brand,
			status: 'done',
			limit,
			offset,
		});

	if (purpose === 'sample') {
		const { items } = await fetchPage(0, 1);
		return items.map((run) => ({ brand, ...run }));
	}

	const seen = state.rankingAdvice as { key: string; runIds: number[] } | undefined;
	const remembered = purpose === 'check' && seen?.key === brand ? seen.runIds : undefined;
	const seenIds = new Set(remembered);
	const walk = async (offset: number, pagesLeft: number): Promise<AdviceRun[]> => {
		const page = await fetchPage(offset);
		const allNew = page.items.every((run) => !seenIds.has(run.run_id));
		return remembered && allNew && page.has_more && pagesLeft > 1
			? [...page.items, ...(await walk(offset + page.items.length, pagesLeft - 1))]
			: page.items;
	};
	// A run that finishes mid-walk shifts the pages by one, so a run can appear twice.
	const runs = [
		...new Map((await walk(0, MAX_ADVICE_PAGES)).map((run) => [run.run_id, run])).values(),
	];
	state.rankingAdvice = {
		key: brand,
		runIds: [...new Set([...runs.map((run) => run.run_id), ...seenIds])].slice(
			0,
			MAX_REMEMBERED_RUNS,
		),
	};
	if (!remembered) {
		return [];
	}
	return runs
		.filter((run) => !seenIds.has(run.run_id))
		.reverse()
		.map((run) => ({ brand, ...run }));
}

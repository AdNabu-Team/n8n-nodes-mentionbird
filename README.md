# n8n-nodes-mentionbird

This is an n8n community node for [MentionBird](https://mentionbird.ai). It lets you use your MentionBird data in n8n workflows, start workflows when it changes, and give it to an AI Agent as a tool.

MentionBird tracks how a brand shows up in AI answers on ChatGPT, Claude, Gemini, Perplexity and Grok: how often the brand is mentioned, which competitors are named instead, which pages and domains the AI platforms cite, and what to change to rank better.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Usage](#usage)
- [Example workflows](#example-workflows)
- [Compatibility](#compatibility)
- [Resources](#resources)
- [Development](#development)
- [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and install `n8n-nodes-mentionbird`.

## Credentials

The node signs in with a MentionBird API key, sent as a bearer token.

1. In MentionBird, open **API & integrations** and create an API key on the **Manage access** tab. To use the **Add** operations, tick **Allow this key to make changes (write access)**. A read-only key can use every other operation.
2. In n8n, create a **MentionBird API** credential and paste the key into **API Key**.
3. Leave **Base URL** at `https://api.mentionbird.ai` unless MentionBird gave you another address.

Saving the credential tests it by listing your tracked brands. MentionBird's [authentication docs](https://docs.mentionbird.ai/authentication/) have more on API keys.

The node takes API keys only. Signing in with OAuth, as MCP clients do, isn't supported by the REST API it calls.

## Operations

Each operation calls one endpoint of MentionBird's REST API. The **Add** operations need a key with write access.

<!-- operations:start -->

| Resource    | Operation                 | What it does                                                                                                                                                                                      | Endpoint                             |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| AI Platform | Get Many                  | List the AI platforms available to this workspace (ChatGPT, Claude, Gemini, Perplexity, Grok) and the models behind them.                                                                         | `GET /api/v1/llm-providers`          |
| Answer      | Get Many                  | Recent AI answers for the brand's prompts, each with a short preview of the answer. To read one answer in full, take its 'Answer ID' from this list and call Answer → Get.                        | `GET /api/v1/query-runs`             |
| Answer      | Get                       | One run in full: the complete answer text, every brand mentioned, every source cited and every web search the AI ran. Use this after Answer → Get Many when the preview isn't enough.             | `GET /api/v1/query-runs/{run_id}`    |
| Brand       | Get Many                  | List every brand this workspace tracks. Call this first — other endpoints take the brand name exactly as returned here.                                                                           | `GET /api/v1/brands/tracked`         |
| Brand       | Add                       | Start tracking a new brand. Requires a write-enabled API key.                                                                                                                                     | `POST /api/v1/brands/tracked`        |
| Brand       | Get Competitors           | List the competitors tracked for a brand, with each one's domain. Visibility → Get Share of Voice marks their rows is_tracked_competitor.                                                         | `GET /api/v1/brands/competitors`     |
| Citation    | Get Many                  | Individual cited URLs with page metadata, for detailed source analysis.                                                                                                                           | `GET /api/v1/citations`              |
| Citation    | Get Top Domains           | The domains AI platforms cite most when answering this brand's prompts.                                                                                                                           | `GET /api/v1/citations/domains`      |
| Citation    | Get Owned vs Earned Share | How citations split between domains the brand owns, competitor-owned domains and earned third-party coverage.                                                                                     | `GET /api/v1/sources/owned-share`    |
| Citation    | Get Breakdown             | The kinds of sources AI platforms cite when answering this brand's prompts: those citations grouped by 'Source Type' (kind of site), 'Content Type' (kind of page) or 'URL Status' (link health). | `GET /api/v1/citations/breakdown`    |
| Citation    | Get Taxonomy              | The valid 'Source Type' and 'Content Type' values to pass to the citation endpoints. 'Source Type' describes the kind of site, 'Content Type' the kind of page.                                   | `GET /api/v1/citations/tags`         |
| Prompt      | Get Many                  | List the prompts tracked for a brand, with their search-volume and difficulty buckets and the prompt ID token other endpoints need.                                                               | `GET /api/v1/queries`                |
| Prompt      | Get Tags                  | List the tags this workspace has assigned to a brand's prompts. Pass a tag's slug as 'Prompt Tag' on other endpoints.                                                                             | `GET /api/v1/queries/tags`           |
| Prompt      | Get Many by Visibility    | Prompts ordered by visibility: ascending finds the gaps where the brand loses, descending finds the wins.                                                                                         | `GET /api/v1/prompts/by-visibility`  |
| Prompt      | Get Leaderboard           | For ONE prompt: headline metrics plus every brand named on it, ranked. Requires 'Prompt ID' from Prompt → Get Many.                                                                               | `GET /api/v1/prompts/leaderboard`    |
| Prompt      | Get Ranking Advice        | Completed ranking-advice runs for ONE prompt — what to change to rank better. Read-only: this never starts a new run. Requires 'Prompt ID' from Prompt → Get Many.                                | `GET /api/v1/prompts/ranking-advice` |
| Prompt      | Get Ranking Advice Runs   | Ranking-advice runs across ALL of a brand's prompts. Use this to find which prompts already have advice before calling Prompt → Get Ranking Advice.                                               | `GET /api/v1/ranking-advice`         |
| Prompt      | Add                       | Add prompts to track for a brand across the chosen AI platforms and queue the first crawl. Requires a write-enabled API key.                                                                      | `POST /api/v1/prompts`               |
| Visibility  | Get                       | How often the brand appears in AI answers, plus prominence score, average rank and sentiment. Group overall, by day, by platform or by tag.                                                       | `GET /api/v1/visibility`             |
| Visibility  | Get Share of Voice        | The brands named most often across this brand's tracked prompts — who you are losing to, and by how much.                                                                                         | `GET /api/v1/brands/top-mentioned`   |
| Web Search  | Get Many                  | The searches AI models ran before answering this brand's prompts - the terms to rank for, as opposed to the pages already cited.                                                                  | `GET /api/v1/searches`               |
| YouTube     | Get Many                  | Cited YouTube videos this brand has already paid to summarize.                                                                                                                                    | `GET /api/v1/youtube/summaries`      |
| YouTube     | Get                       | Summary, key points and optional transcript for one cited YouTube URL.                                                                                                                            | `GET /api/v1/youtube/summary`        |

<!-- operations:end -->

## Trigger

The **MentionBird Trigger** node starts a workflow when one of these happens for a brand:

- **Visibility Changed:** the brand's visibility on the last complete day moved by at least **Minimum Change** percentage points. It's compared with the previous day that had AI answers, or with the average of the previous 7 days, which is steadier for a brand with few prompts. **Direction** narrows it to drops or rises, and **Options** to one AI platform or prompt tag. Days are UTC days, and a day counts as complete from 04:00 UTC the next day, an hour after MentionBird's nightly aggregation. A day without any AI answers is skipped, not read as a drop to zero. Days missed while n8n or MentionBird was down are compared once both are back, up to 7 days.
- **New Ranking Advice:** a ranking-advice run finished for one of the brand's prompts. Each run starts the workflow once.

Activating the workflow records where things stand, so the trigger starts workflows only for what happens afterwards, including after it was switched off for a while. Activation checks the settings with MentionBird, so a wrong brand or prompt tag fails it with MentionBird's message. Restarting n8n keeps the trigger's place, so nothing that happens meanwhile is missed or repeated. **Fetch Test Event** returns the latest comparison, or the newest-started ranking-advice run, whatever the minimum change.

**How often it calls MentionBird.** n8n checks a polling trigger every minute by default. Visibility changes once a day, and a quarter-hour's delay on new ranking advice costs little, so the trigger calls the API at most once every 15 minutes, whatever **Poll Times** says. A failed check waits as long, or longer if MentionBird's rate limit asks it to. Visibility Changed makes about one request a day, once the new day is complete. New Ranking Advice makes one request per check, plus one for each further 50 runs that finished since the previous check, up to three more. That's 96 requests a day in the usual case and 384 at most, within MentionBird's per-key limit of 10,000 a day.

## Usage

**Choosing a brand.** Most operations ask for a **Brand**. Pick it **From List**, which shows the brands your workspace tracks, or switch to **By Name** and type or map the name exactly as MentionBird shows it.

**Lists.** Operations that return a list output one n8n item per row. Turn on **Return All** to read every row, or set **Limit** to the number you want; the node reads as many pages as that takes. Operations that return a summary, such as Visibility → Get, output a single item.

An empty list outputs no items, so the nodes after it don't run. To get the totals and summary fields that come with a list, such as the search coverage of Web Search → Get Many, or one item even when the list is empty, set **Options → Output** to **Whole Response**. The node then outputs one item, with the rows in `items`.

**List fields.** Fields that take several values, such as **Prompts** and **Tags**, take one value per line, or an expression that returns an array.

**Optional settings.** Date ranges, AI platform, prompt tag and other filters are under **Options** (or **Additional Fields** on the Add operations). Dates use the `YYYY-MM-DD` format; without them, MentionBird reads the last 30 days.

**Errors.** When MentionBird rejects a request, the node shows MentionBird's own message, such as an untracked brand name or a read-only key. If you send requests faster than your key's rate limit allows, the node reports that the service is receiving too many requests; space them out with the node's **Retry On Fail** setting or by batching the items that feed it. While reading several pages, the node waits and retries a rate-limited page itself when MentionBird asks it to wait a minute or less, keeping the pages it already has.

**AI Agents.** The node can be attached to an AI Agent as a tool. Add one MentionBird tool per question the agent should be able to answer, for example Brand → Get Many and Visibility → Get, and let the model fill in parameters such as **Brand** by choosing **Let the model define this parameter**.

## Example workflows

**A Slack alert when visibility drops**

1. **MentionBird Trigger**, Visibility Changed, with your brand, **Minimum Change** 5, **Direction** Down and **Compare With** Previous 7 Days' Average.
2. **Slack**, Send Message, with text such as `{{ $json.brand }}'s visibility fell {{ Math.abs($json.change_pts) }} points to {{ $json.visibility_pct }}% on {{ $json.date }}.`

**New ranking advice into Notion**

1. **MentionBird Trigger**, New Ranking Advice, with your brand.
2. **Notion**, Create Database Page, with the prompt from `{{ $json.prompt_text }}` and the advice from `{{ $json.summary }}`.

**Weekly AI visibility report in Slack**

1. **Schedule Trigger**, every Monday morning.
2. **MentionBird**, Visibility → Get, with your brand. Under **Options**, set **Group By** to **AI Platform** to get one item per platform.
3. **MentionBird**, Visibility → Get Share of Voice, with the same brand and **Limit** 5, to see which competitors AI answers name most.
4. **Slack**, Send Message, with the visibility and share-of-voice figures mapped into the text.

**An AI Agent that answers questions about your AI visibility**

1. **Chat Trigger**.
2. **AI Agent**, with a chat model of your choice.
3. MentionBird tools attached to the agent: Brand → Get Many, Visibility → Get, Prompt → Get Many by Visibility and Citation → Get Top Domains. On each tool that has a **Brand**, choose **Let the model define this parameter**.
4. Ask questions such as "Which of our prompts do we lose on ChatGPT, and which domains do those answers cite?"

**Track new prompts from a spreadsheet**

1. **Google Sheets Trigger**, on a row added to a sheet with a `prompt` column.
2. **MentionBird**, Prompt → Add, with your brand, **Prompts** set to `{{ $json.prompt }}` and the AI platforms to track it on. This needs a key with write access.

## Compatibility

Built with `@n8n/node-cli` 0.53 and tested with self-hosted n8n 2.44.7.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [MentionBird API documentation](https://docs.mentionbird.ai/)

## Development

The node's resources, operations and parameters are generated from MentionBird's `/api/v1` OpenAPI spec, so they stay in step with the API.

| Path                              | What it is                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi/mentionbird-api-v1.json` | The pinned copy of the spec the node is generated from.                                                                                                                                           |
| `scripts/layout.mjs`              | How the spec's operations are laid out in n8n: the resource each one belongs to, operation names, and labels or pickers for particular parameters.                                                |
| `scripts/generate.mjs`            | The generator. It writes `nodes/MentionBird/generated/properties.ts` and the operations table in this README.                                                                                     |
| `nodes/MentionBird/`              | The node. Everything outside `generated/` is written by hand: paging and error handling (`hooks.ts`), the brand picker and AI-platform list (`methods.ts`), and the API address (`transport.ts`). |

Commands:

- `npm run spec:update` pins the live spec and regenerates. To use another source, such as a local server or a file, pass it: `npm run spec:update -- http://localhost:8040/api/v1/openapi.json`.
- `npm run generate` regenerates from the pinned spec.
- `npm run build` regenerates, then builds. `npm run lint` runs n8n's linter.

Generation stops with an error when an operation's tag isn't mapped to a resource in `scripts/layout.mjs`, so a new tag gets a deliberate place in the node. CI fails when the committed generated code doesn't match the pinned spec.

A list endpoint is read in pages of the `limit` maximum its spec declares, or 50 when it declares none, which every list endpoint accepts.

### Keeping up with the API

Every Monday, `.github/workflows/spec-sync.yml` runs `npm run spec:update` against the live API. When the pinned spec or the regenerated node differs from `main`, it opens a pull request from the `spec-sync` branch, or updates the one already open. A later run that finds no difference closes it. To review one:

1. Approve its CI run in the merge box. A pull request opened with the workflow's `GITHUB_TOKEN` starts its checks only after someone with write access approves them.
2. Read the diff of `nodes/MentionBird/generated/properties.ts`, and check the names and labels of any new operations and parameters.
3. If `nodes/MentionBird/generated/` changed, release a new version after merging (see [Publishing](#publishing)).

Make any change to the layout on `main`, then run the workflow again from the Actions tab: each run rebuilds the `spec-sync` branch from `main`, replacing any commit pushed to it.

The run fails instead of opening a pull request when:

- the live spec drops an operation or parameter that the pinned spec has. `/api/v1` only grows, so this usually means an older or broken deploy. To follow a removal on purpose, run `npm run spec:update -- --allow-removals` locally.
- an operation arrives under a tag that `scripts/layout.mjs` doesn't map. Map the tag, then run the workflow again.

In a public repository, GitHub turns off a scheduled workflow after 60 days without repository activity. Turn it back on from the Actions tab or with `gh workflow enable spec-sync.yml`.

### Testing in n8n

Test with a MentionBird workspace kept for testing. The **Add** operations create real brands and prompts in it, which count toward its plan, and adding prompts queues their first crawl. A read-only key covers every other operation.

1. Run n8n in Docker and load the built package from its custom-extensions folder:

   ```bash
   docker run -d --name n8n-dev -p 127.0.0.1:5678:5678 -v n8n-dev-data:/home/node/.n8n docker.n8n.io/n8nio/n8n
   npm run build && npm pack
   tar -xzf n8n-nodes-mentionbird-*.tgz
   docker exec n8n-dev mkdir -p /home/node/.n8n/custom/node_modules
   docker cp package n8n-dev:/home/node/.n8n/custom/node_modules/n8n-nodes-mentionbird
   docker restart n8n-dev
   ```

   The node then appears in n8n as **MentionBird**.

2. Create a **MentionBird API** credential with a key from that workspace, as described under [Credentials](#credentials).

### Publishing

`.github/workflows/publish.yml` publishes to npm with a provenance statement when a version tag is pushed. It runs in the `npm` GitHub environment, which admits only version tags (`*.*.*`) and waits for a required reviewer to approve the run in the Actions tab.

To release, run `npm run release` on `main`: it bumps the version, tags and pushes. Then approve the waiting Publish run.

#### First release

npm's Trusted Publishing, which publishes with no stored token, can only be set up for a package that already exists. So the first version is published with a token, in this order:

1. Make the repository public. npm rejects provenance from a private repository.
2. In the repository's settings, under **Environments → npm**, add the required reviewers. GitHub's Team plan offers required reviewers only on public repositories.
3. On npmjs.com, signed in as the account that will own the package, create a granular access token:
   - **Read and write (publish and stage)** on all packages. A token can't name a package that doesn't exist yet, so it can also publish any other package the account can.
   - Two-factor authentication bypassed.
   - A short expiry.

   Save it as a secret of the `npm` environment, named `NPM_TOKEN`. npm is removing direct publishing with tokens that bypass two-factor authentication, targeting January 2027.

4. On `main`, tag the version already in `package.json` and push the tag: `git tag 0.1.0 && git push origin 0.1.0`. `npm run release` always bumps the version, so it can't publish that one. Approve the Publish run.
5. Once the package is on npm, delete the `NPM_TOKEN` secret and revoke the token.
6. Before the next release, add a trusted publisher in the package's settings on npmjs.com: GitHub Actions, `AdNabu-Team/n8n-nodes-mentionbird`, workflow `publish.yml`, environment `npm`. A new trusted publisher expires unless it publishes within 2 days, so release soon after. Then set the package's publishing access to require two-factor authentication and disallow tokens.

`package.json` sets `publishConfig.access` to `public`: npm generates provenance for a package's first version only with public access.

After publishing, check the package with:

```bash
npx @n8n/scan-community-package n8n-nodes-mentionbird
```

## Version history

### 0.1.0

First release: every operation of MentionBird's `/api/v1` REST API, a brand picker, paging, use as an AI Agent tool, and a trigger for visibility changes and new ranking advice.

# Omnigent API Evaluator

Pick a third-party API and ship the integration, with every fact sourced from the live web and
every step checked by a model from a different vendor.

Built on [Omnigent](https://github.com/omnigent-ai/omnigent), Databricks' open-source
meta-harness, using the Nimble connector's three capabilities.

## The problem

Ask a model which geocoding API to use and it answers from training data that's a year stale.
Ask it to write the integration and it writes against method names and parameters that were
renamed two releases ago. Both answers look confident. Neither is checkable.

The facts that actually decide these choices are the ones models are worst at: current pricing,
rate limits, and licence terms. For geocoding specifically, whether you may cache results at all
varies per vendor and carries conditions:

| | May you cache results? |
|---|---|
| OpenCage | Yes, unconditionally |
| Google | Generally prohibited — narrow exception for lat/lng only, ≤30 consecutive days, then delete |
| Mapbox | Only with `permanent=true`, a tier costing roughly 6.7× the temporary one |
| HERE | Only up to 30 days outside the Platform |

Two different 30-day rules with different conditions. This is not a question a chat answer
settles.

## How it runs

Three agents, all in the Omnigent UI.

### Act 1 — build the evidence

`evidence-builder` runs one Web Search Agent task per candidate against a single output schema.
Runs go in parallel: **six candidates in ~5.5 minutes** at `high` effort.

Every field arrives with its own citations and confidence, because `trust.claims[]` is keyed by
JSONPath into your schema:

```json
{"path": "$.free_tier", "confidence": "high",
 "citations": [{"url": "https://mapbox.com/pricing", "title": "Mapbox pricing"}]}
```

That's what makes the next step honest: a field with no citations is flagged `cited: false` in
code, not left to a model's discretion.

### Act 2 — two vendors decide

A Claude head and a GPT head read **the same evidence file**. Neither researches independently,
so they argue about judgment rather than facts. Anything uncited is struck and cannot decide the
outcome.

In the reference run both heads independently chose OpenCage, both independently struck an
uncited pricing field, and both refused to price Mapbox because the evidence didn't say whether
its free tier covers `permanent=true`. They disagreed on exactly one thing — the fallback for
bursty traffic — and that disagreement sat precisely where the evidence had a hole.

### Act 3 — build it, and have another vendor check

The orchestrator hands the winner to an implementation sub-agent that reads the current API
reference through Nimble (`search_depth: deep` returns full page content), then routes the diff
to a reviewer **from a different vendor**. The implementer never approves its own work.

In the reference run the reviewer caught a real Unicode uppercase-expansion bug — the `ß` → `SS`
class of problem — that the implementer's own tests had missed.

## Prerequisites

**Two model vendors are required.** Act 2 runs a Claude head and a GPT head; Act 3's cross-review
needs a reviewer from a *different vendor* than the implementer. With one vendor, Act 3 cannot run
independent review and will say so rather than fake it.

You do **not** need paid API accounts — existing **Claude Code** and **Codex CLI** logins satisfy
this. Confirm with `omnigent config list`.

Also required: **Python 3.12+**, **tmux** (the native harnesses launch a terminal and fail without
it), and a **Nimble API key**.

## Setup

```bash
uv pip install 'omnigent[nimble]'      # or: pip install --pre 'omnigent[nimble]'
brew install tmux                       # required by the native harnesses
npm install -g @openai/codex            # the second vendor
export NIMBLE_API_KEY="..."
```

Keep the quotes — zsh expands unquoted brackets. `--pre` is required for pip because a
transitive dependency publishes only pre-releases.

Model credentials: **either** API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) **or** existing
CLI subscriptions. Omnigent falls back to the Claude Code and Codex CLI logins when no keys are
set, so two CLI logins are enough.

Verify both builtins resolve:

```bash
python -c "from omnigent.tools.builtins import nimble_research, nimble_extract; print('ok')"
```

## Gotchas worth knowing before you start

- **`claude-sdk` and `claude-native` authenticate differently.** `claude-sdk` needs a funded
  Anthropic API key; `claude-native` runs off the Claude Code subscription. The shipped example
  agents use `claude-sdk` — switch them if your key isn't funded.
- **Allow-list the MCP tools.** `claude-native` *is* Claude Code, so sub-agent dispatch hits its
  permission prompt. In the UI you approve it; unattended it fails as "blocked by a permission
  hook".
- **Keep `web_search` queries short.** The builtin hardcodes a 30-second timeout with no config
  knob. A verbose query took 145s against the API and timed out; 3–4 word queries return in
  12–17s.
- **Always set `timeout_seconds` on `nimble_research`.** The 300s default is shorter than a
  healthy `high`-effort run.
- **Research runs are billable and not idempotent.** The builtin issues create exactly once and
  never retries. Don't resubmit a failed call — reconcile by run id.
- **Use absolute paths.** Agents don't reliably resolve relative ones.
- **`effort` changes quality, not just speed — and `low` can change the answer.** At `low`, array
  fields come back as prose and numeric fields hand-wave. Worse, a candidate can return mostly
  null, uncited fields; since uncited claims are struck, that candidate drops out of the comparison
  and the decision resolves to whoever happened to return data. Use `high` for anything you act on.
- **Your own Claude Code plugins can shadow this cookbook's tools.** The `claude-native` harness
  *is* Claude Code, so it loads whatever plugins you have installed. If one of them exposes
  similar tools, the agent may use those instead of the builtins declared in the agent config —
  silently. The bundled `.claude/settings.json` denies the tools known to overlap; if an act
  behaves oddly, check which tools it actually called.
- **Pinning a model? Put it in the right place.** `model:` under `executor.config` — right beside
  `harness`, the obvious spot — is silently ignored, and you keep paying for the default. It must
  be `executor.model`, a sibling of `config:`. A wrong model *id* is also accepted verbatim rather
  than rejected. Neither mistake raises an error, so after your first run check `omnigent usage`
  to confirm which model actually billed.

## Cost

Measured with `omnigent usage`, which reports best-effort estimates.

| Step | Cost |
|---|---|
| Act 2 — two-head decision | ~$1.80 |
| Act 3 — two tasks + cross-review | ~$6.73 |

A full three-act run is roughly **$8–9 in model spend**, plus Nimble usage. Most of it is the
Claude side resolving to Opus.

## Running it

Three agents, run in order from the Omnigent UI (`omnigent run ./agents/<name>` starts the server
and prints the URL). Each act hands the next one a file.

```bash
omnigent run ./agents/evidence-builder   # Act 1 — builds the cited evidence base
omnigent run ./agents/decide             # Act 2 — two vendors argue over it
omnigent run ./agents/build              # Act 3 — implement + cross-vendor review
```

**Give each agent an absolute path** to the evidence file in your first message — agents do not
resolve relative paths reliably. For example: *"Read /abs/path/data/evidence.json. We geocode ~50k
addresses a month and must cache results 30 days. Which API?"*

To skip the wait, copy the bundled `data/evidence_full.json` to `data/evidence.json` and start
at Act 2.

## Swapping the domain

Geocoding is the worked example, not a dependency. Replace the candidate list and the schema
field descriptions; everything else stays. The pattern suits any category where pricing and
licence terms move and are web-only.

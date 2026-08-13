# ai-setup

Drop this file into Claude Code (or any coding agent) and it will set the cookbook up and run it.

You are setting up **Omnigent API Evaluator** — three Omnigent agents that pick a third-party API
and ship the integration, with every fact sourced from the live web through Nimble and every step
checked by a model from a different vendor.

Work through the steps in order. Stop and tell the user if a check fails; do not paper over it.

---

## Step 1 — Check the prerequisites

```bash
python3.12 --version       # need 3.12+ — check for 3.12 SPECIFICALLY, not `python3`,
                           # which on many machines is still an older system Python
tmux -V                    # required: native harnesses fail without it
claude --version           # Claude Code CLI
codex --version            # Codex CLI
```

**Two model vendors are mandatory, not optional.** Act 3's cross-review needs a reviewer from a
different vendor than the implementer; with one vendor it cannot run independent review and will
say so rather than fake it.

If `tmux` is missing: `brew install tmux` (macOS) or your package manager.
If `codex` is missing: `npm install -g @openai/codex`.

You do **not** need paid API accounts — existing Claude Code and Codex CLI logins are enough.

---

## Step 2 — Install

```bash
python3.12 -m venv .venv
.venv/bin/pip install --pre 'omnigent[nimble]>=0.9.0'
```

Two details matter and both bite:

- **Keep the quotes.** zsh expands unquoted brackets, so `omnigent[nimble]` fails before pip runs.
- **`--pre` is required.** A transitive dependency publishes only pre-releases; without the flag
  pip finds nothing and gives up with `ResolutionImpossible`. `uv pip install` needs no flag.

Verify the builtin resolves:

```bash
.venv/bin/python -c "from omnigent.tools.builtins import nimble_research; print('ok')"
```

---

## Step 3 — Credentials

```bash
cp .env.example .env        # then edit it
export NIMBLE_API_KEY="..."  # from https://online.nimbleway.com/settings/api-keys
```

Confirm Omnigent sees two vendors:

```bash
.venv/bin/omnigent config list
```

You want Claude and Codex both present — either with a key or a CLI subscription. If a model API
key is set but **out of credit**, unset it: Omnigent prefers the key over the subscription and the
run fails with "Credit balance is too low".

---

## Step 4 — Start the server

```bash
.venv/bin/omnigent server --background
```

Open **http://127.0.0.1:6767**. All three acts appear here as you run them, and the Subagents
panel shows Act 2's two heads and Act 3's workers live.

On first launch a theme picker appears — press Enter to dismiss it.

---

## Step 5 — Act 1: build the cited evidence base

```bash
.venv/bin/omnigent run ./agents/evidence-builder
```

Prompt it with your candidates and an **absolute** output path:

> Build the evidence base at HIGH effort for these candidates: OpenCage Geocoding API, HERE
> Geocoding and Search API. Write the file to `<ABSOLUTE PATH>/data/evidence.json`

**Use absolute paths.** Agents do not resolve relative ones reliably.

Expect one `nimble_research` call per candidate, roughly 1–5 minutes each, run sequentially.
Each returns a schema-conforming answer plus per-field citations and confidence.

⚠ **Do not lower `effort` to save time.** At `low`, a candidate can come back mostly uncited — and
since uncited claims are struck in Act 2, that silently removes it from the comparison and changes
the answer. `high` for anything you act on.

A pre-built six-candidate evidence file ships in `data/evidence_full.json`. Copy it to
`data/evidence.json` to skip straight to Act 2 without waiting for the research runs.

---

## Step 6 — Act 2: two vendors decide

```bash
.venv/bin/omnigent run ./agents/decide
```

> Read `<ABSOLUTE PATH>/data/evidence.json`. We geocode ~50k addresses a month and must cache
> results for 30 days. Which API should we use? Dispatch to BOTH heads, then show both answers
> side by side with an agree/differ section.

A Claude head and a GPT head read the **same file**, so they argue about judgment rather than
facts. Any claim without a citation is struck and cannot decide the outcome.

Watch for the disagreement section. Where the evidence is solid the heads agree; where it has a
hole they diverge — and that divergence names what still needs verifying.

Takes 5–8 minutes. Approval prompts may appear in the UI; approve them and it continues.

---

## Step 7 — Act 3: build it, with cross-vendor review

Act 3 needs a git repo to work in. Use your own project, or a scratch one:

```bash
mkdir -p ~/geo-demo && cd ~/geo-demo && git init -q
mkdir -p geo tests && printf '"""Geocoding client."""\n' > geo/__init__.py
git add -A && git commit -qm "initial"
python3.12 -m venv .venv && .venv/bin/pip install pytest
```

Then, from that repo:

```bash
<PATH TO COOKBOOK>/.venv/bin/omnigent run <PATH TO COOKBOOK>/agents/implement
```

> Implement a minimal OpenCage geocoding client in geo/client.py with a geocode(query) function,
> plus tests in tests/test_client.py. gh is NOT installed and there is no remote — do not open a
> PR and do not push; commit to a local branch and treat the branch plus diff as the deliverable.
> Run tests with `python -m pytest -q`. When green, cross-review with the OPPOSITE vendor.

One worktree and branch per task. The implementer drives to green, then a **different vendor's**
model reviews the diff — given only the diff and the contract, never the implementer's transcript.
Blocking issues become fixes on the same branch. It never merges; the branch is the deliverable.

Takes 5–9 minutes. **Approval prompts will appear** — the workers run with approvals on
(`yolo: false`, `permission_mode: ask`), so file writes and shell commands ask first. Approve them
in the Omnigent UI as they come up, or the act waits.

---

## Gotchas worth knowing

- **Connector builtins only work on wrapped harnesses.** Native harnesses (`claude-native`,
  `codex-native`) ignore the spec's tools list entirely — their only tool surface is Omnigent's
  relay, which carries the `sys_*` families and **not** `nimble_research` or `web_search`. That is
  why Act 1 runs on `codex` and not `claude-native`. If you change a harness and the builtin
  stops resolving, this is why.
- **Your own Claude Code plugins can shadow these tools.** The `claude-native` harness *is* Claude
  Code and loads your plugins; if one exposes similar tools the agent may use those instead,
  silently. `.claude/settings.json` denies the known overlaps.
- **Pinning a model? Placement matters.** `model:` under `executor.config` — next to `harness`,
  the obvious spot — is silently ignored and you keep paying for the default. It must be
  `executor.model`. A wrong model *id* is also accepted verbatim. Neither raises an error, so
  check `omnigent usage` after your first run to see which model actually billed.
- **Keep `web_search` queries short.** That builtin hardcodes a 30-second timeout with no config
  knob; verbose queries time out while 3–4 word ones return in 12–17s.
- **Research runs are billable and never retried.** The builtin issues create exactly once. On a
  transport error or timeout the billing outcome is unknown — reconcile by run id, do not resubmit.

## Cost

Roughly **$8–9 in model spend** for a full three-act run, plus Nimble usage. Most of it is the
Claude side resolving to Opus. `omnigent usage` shows the real per-session breakdown.

/**
 * POST /api/research
 *
 * Accepts a patent cliff task (drug list), starts or resumes a Nimble
 * Web Search Agent run, and returns a JSON response with the runId.
 *
 * The UI polls this endpoint to check progress and fetch the final report.
 *
 * Environment:
 *   NIMBLE_API_KEY      — from online.nimbleway.com
 *   NIMBLE_AGENT_ID     — pre-created Web Search Agent from Nimble console
 *   OPENAI_API_KEY      — used once per report, to start the run via the connector
 *   OPENAI_MODEL        — optional, defaults to gpt-5-nano
 */
import { NextResponse } from 'next/server';
import { researchErrorMessage, startPatentCliffPhase, resumePatentCliffPhase } from '@/lib/agent';

export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * A missing environment variable is a local misconfiguration, not a failure
 * upstream at Nimble. Returning 502 for it makes a config problem look like an
 * outage.
 */
function errorStatus(message: string) {
  return message.startsWith('Missing ') ? 500 : 502;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const { task, runId } = (body && typeof body === 'object' ? body : {}) as {
    task?: unknown;
    runId?: unknown;
  };

  if (typeof runId === 'string' && runId.trim()) {
    try {
      const { text, result } = await resumePatentCliffPhase(runId.trim(), { abortSignal: req.signal });
      return NextResponse.json({ text, result });
    } catch (error) {
      console.error('Failed to resume Nimble research run', error);
      const message = researchErrorMessage(error, 'Unable to retrieve this research run.');
      return NextResponse.json({ error: message }, { status: errorStatus(message) });
    }
  }

  if (typeof task !== 'string' || !task.trim()) {
    return NextResponse.json(
      { error: 'Missing "task" in request body.' },
      { status: 400 }
    );
  }

  try {
    const { text, runId: newRunId, effort, status } = await startPatentCliffPhase(task.trim());
    return NextResponse.json({ text, runId: newRunId, effort, status });
  } catch (error) {
    console.error('Failed to start Nimble research run', error);
    const message = researchErrorMessage(error, 'Unable to start research. Check the Nimble configuration and try again.');
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { linkCitations, type Trust } from '../app/report';

const trust: Trust = {
  claims: [
    { callout: 1, citations: [{ url: 'https://fda.gov/biosimilars' }] },
    { callout: 2, citations: [{ url: 'https://courtlistener.com/docket' }] },
    { callout: 3, citations: [] },
  ],
};

test('links a callout marker to the source Nimble cited for it', () => {
  const linked = linkCitations('Amjevita approved Sept 2016 [1]', trust);

  assert.equal(linked, 'Amjevita approved Sept 2016 [[1]](https://fda.gov/biosimilars)');
});

test('leaves a callout with no citation as plain text', () => {
  assert.equal(linkCitations('pricing unchanged [3]', trust), 'pricing unchanged [3]');
  assert.equal(linkCitations('no such claim [99]', trust), 'no such claim [99]');
});

test('does not touch a marker that is already a link', () => {
  const already = 'see [2](https://example.com/original)';

  assert.equal(linkCitations(already, trust), already);
});

test('is idempotent, so a re-render never double-wraps', () => {
  const once = linkCitations('claim one [1] and two [2]', trust);

  assert.equal(linkCitations(once, trust), once);
});

test('returns the report untouched when the run carried no trust metadata', () => {
  const report = 'Findings [1] and [2].';

  assert.equal(linkCitations(report, undefined), report);
  assert.equal(linkCitations(report, { claims: [] }), report);
});

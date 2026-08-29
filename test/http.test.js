import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_AGENT } from '../http.js';

test('default API User-Agent uses the WikiSync-compatible descriptive form', () => {
  assert.equal(
    USER_AGENT,
    'osrs-tracker/1.1.0 (https://github.com/Nikamura/osrs-tracker; contact: GitHub @Nikamura)'
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY_TYPE_MIGRATION, friendlyError } from '../lib/useTravelData';

test('activity type constraint failures point to the repair migration', () => {
  const message = friendlyError({ code: '23514', message: 'new row violates check constraint "activities_type_check"' });
  assert.ok(message.includes(ACTIVITY_TYPE_MIGRATION));
});

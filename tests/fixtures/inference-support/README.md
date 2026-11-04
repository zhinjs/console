# Inference support producer fixtures

These JSON responses were generated from the backend's real
`basic/cli/tests/plugin-runtime/inference/support-fixture.ts` using its
`HostInference`, temporary SQLite repository, and held Snapshot:

```ts
const fixture = await supportFixture();
const held = fixture.host.acquireManagement();
try {
  const operator = await held.management.view(fixture.operator);
  const member = await held.management.view(fixture.member);
  // Serialize these responses as operator.json and member.json.
} finally {
  await held.release();
  await fixture.close();
}
```

Only the temporary Host root path was normalized to
`/synthetic/inference-support-host`; references and optional fields retain the
producer's structure. The owner IDs and `privateMarker` are synthetic test data,
not credentials. The two notices are fixture text, not product copy.

The responses include same-ID Drivers with different owners, unavailable Driver
versions, and a missing Driver. The member response keeps the existing public
Driver declarations and deployment references but has no Host Service, Account,
Profile, status, or private Service options. Rendering these fixtures does not
exercise OAuth, provider inference, billing, or real accounts.

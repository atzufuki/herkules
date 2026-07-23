/**
 * GravityWorker - GitHub App Manifest Module Tests
 */

import { assertEquals, assert } from "@std/assert";
import { buildAppManifest } from "../github_app.ts";

Deno.test("GitHub App - manifest building", () => {
  const manifest = buildAppManifest({ appName: "gravity-worker-test" });
  assertEquals(manifest.name, "gravity-worker-test");
  assert(manifest.default_permissions !== undefined);
  assertEquals((manifest.default_permissions as Record<string, string>).issues, "write");
  assertEquals((manifest.default_permissions as Record<string, string>).pull_requests, "write");
});

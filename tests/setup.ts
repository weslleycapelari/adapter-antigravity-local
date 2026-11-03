import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

// Keep the original suite away from the host's credentials, skills and ledger.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "agy-source-suite-"));
vi.spyOn(os, "userInfo").mockReturnValue({ ...os.userInfo(), homedir: testHome });
process.env.PAPERCLIP_ANTIGRAVITY_QUOTA_FILE = path.join(testHome, "quota.json");
vi.stubGlobal("fetch", async () => {
  throw new Error("External API calls are disabled in the test suite");
});

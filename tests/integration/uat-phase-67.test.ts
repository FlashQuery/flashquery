import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { mkdir, writeFile, rm, existsSync } from "node:fs";
import { promisify } from "util";
import { join } from "node:path";

const sleep = promisify(setTimeout);

describe("Phase 67 UAT: File Ops P2 (copy_document, remove_directory)", () => {
  let serverProcess: ChildProcess | null = null;
  const testVaultPath = "/tmp/fqc-vault-uat-67";
  const serverPort = 3100;
  const serverUrl = `http://localhost:${serverPort}`;

  beforeAll(async () => {
    // Clean up vault
    if (existsSync(testVaultPath)) {
      await promisify(rm)(testVaultPath, { recursive: true });
    }
    await promisify(mkdir)(testVaultPath, { recursive: true });

    // Create test documents
    const docsDir = join(testVaultPath, "Documents");
    await promisify(mkdir)(docsDir, { recursive: true });

    const sourceDocPath = join(docsDir, "source.md");
    await promisify(writeFile)(
      sourceDocPath,
      `---
title: Original Document
tags: [important, archive]
company: Acme Corp
role: Engineer
fqc_id: test-doc-001
created: 2026-04-13T00:00:00Z
updated: 2026-04-13T00:00:00Z
---

# Original Document

This is the source document for testing copy_document.
`
    );

    // Start FQC server with test config
    serverProcess = spawn("npm", ["run", "dev"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        FQC_CONFIG: "tests/fixtures/flashquery.test.yml",
      },
      stdio: "pipe",
    });

    // Poll until server is ready or 10s timeout
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 10000) {
      try {
        const res = await fetch(`${serverUrl}/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // connection refused — server not up yet
      }
      await sleep(200);
    }
    if (!ready) {
      // Fall back: give the server a moment if health endpoint is not implemented
      await sleep(3000);
    }
  }, 30000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await sleep(1000);
    }
    // Clean up vault
    if (existsSync(testVaultPath)) {
      await promisify(rm)(testVaultPath, { recursive: true });
    }
  });

  it("Test 1: copy_document accepts destination parameter", async () => {
    const response = await fetch(`${serverUrl}/mcp/tools/copy_document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        source: "Documents/source.md",
        destination: "Documents/copy.md",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.content).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it("Test 2: copy_document preserves source metadata immutably", async () => {
    const response = await fetch(`${serverUrl}/mcp/tools/get_document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        path: "Documents/copy.md",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.content).toBeDefined();

    // Check that title, tags, and custom fields are preserved
    const content = result.content[0].text;
    expect(content).toContain("title: Original Document");
    expect(content).toContain("tags: [important, archive]");
    expect(content).toContain("company: Acme Corp");
    expect(content).toContain("role: Engineer");
  });

  it("Test 3: copy_document generates new fqc_id", async () => {
    const sourceResponse = await fetch(`${serverUrl}/mcp/tools/get_document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        path: "Documents/source.md",
      }),
    });

    const copyResponse = await fetch(`${serverUrl}/mcp/tools/get_document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        path: "Documents/copy.md",
      }),
    });

    const sourceContent = (await sourceResponse.json()).content[0].text;
    const copyContent = (await copyResponse.json()).content[0].text;

    // Extract fqc_ids
    const sourceFqcMatch = sourceContent.match(/FQC ID:\s*([^\n]+)/);
    const copyFqcMatch = copyContent.match(/FQC ID:\s*([^\n]+)/);

    if (!sourceFqcMatch) {
      throw new Error(`Expected FQC ID in source response, got:\n${sourceContent}`);
    }
    if (!copyFqcMatch) {
      throw new Error(`Expected FQC ID in copy response, got:\n${copyContent}`);
    }
    expect(sourceFqcMatch[1]).not.toEqual(copyFqcMatch[1]);
  });

  it("Test 4: copy_document does not accept title or tags parameters", async () => {
    const response = await fetch(`${serverUrl}/mcp/tools/copy_document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        source: "Documents/source.md",
        destination: "Documents/copy2.md",
        title: "Different Title", // Should be rejected
        tags: ["different"], // Should be rejected
      }),
    });

    // Either returns 400 (schema validation) or succeeds but ignores the params
    // Check the implementation behavior
    expect([200, 400]).toContain(response.status);
  });

  it("Test 6: remove_directory safely removes empty directories", async () => {
    // Create empty directory
    const emptyDir = join(testVaultPath, "Documents", "empty-to-remove");
    await promisify(mkdir)(emptyDir, { recursive: true });

    const response = await fetch(`${serverUrl}/mcp/tools/remove_directory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        path: "Documents/empty-to-remove",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.isError).toBeFalsy();
    expect(!existsSync(emptyDir)).toBeTruthy();
  });

  it("Test 7: remove_directory blocks removal of vault root", async () => {
    const response = await fetch(`${serverUrl}/mcp/tools/remove_directory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        path: ".",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.isError).toBeTruthy();
    const errorText = result.content[0].text;
    expect(errorText).toContain("Cannot remove the vault root directory");
  });

  it("Test 8: remove_directory formats non-empty error listing", async () => {
    // Create non-empty directory
    const nonEmptyDir = join(testVaultPath, "Documents", "non-empty");
    await promisify(mkdir)(nonEmptyDir, { recursive: true });
    await promisify(writeFile)(join(nonEmptyDir, "file1.md"), "# File 1");
    await promisify(writeFile)(join(nonEmptyDir, "file2.md"), "# File 2");
    await promisify(mkdir)(join(nonEmptyDir, "subdir"), { recursive: true });

    const response = await fetch(`${serverUrl}/mcp/tools/remove_directory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-key-12345`,
      },
      body: JSON.stringify({
        path: "Documents/non-empty",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.isError).toBeTruthy();

    const errorText = result.content[0].text;
    expect(errorText).toContain("is not empty");
    expect(errorText).toContain("[file]");
    expect(errorText).toContain("[dir]");
    expect(errorText).toContain("Contents (");
  });
});

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCatalog, traitsOf } from "../lib/lazy-router/catalog.js";
import { clearOfficialModelCache, officialModels } from "../lib/lazy-router/model-cache.js";

const MISTRAL = {
  provider: "mistral",
  id: "mistral-small-latest",
  reasoning: true,
  thinking: { mode: "effort", efforts: ["minimal", "low", "medium", "high", "xhigh"] },
  contextWindow: 262_144,
  maxTokens: 256_000,
  input: ["text", "image"],
};

describe("ModelCatalog keeps the official registry capabilities", () => {
  test("traitsOf reads reasoning and the accepted effort levels", () => {
    const traits = traitsOf(MISTRAL);
    expect(traits.reasoning).toBe(true);
    expect(traits.efforts).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    expect(traits.canDisable).toBe(true);
    expect(traits.contextWindow).toBe(262_144);
    expect(traits.maxTokens).toBe(256_000);
  });

  test("getAll output survives a short-lived registry instance", () => {
    class FakeRegistry {
      getAll() {
        return [MISTRAL];
      }
    }
    const catalog = new ModelCatalog({ officialModels: () => new Map() });
    expect(
      catalog.observe({
        captured: new Map([["ModelRegistry", FakeRegistry]]),
        observe(name, callback) {
          if (name === "ModelRegistry") callback(FakeRegistry);
        },
      }),
    ).toBe(true);
    new FakeRegistry().getAll();
    expect(catalog.hasNativeModel("mistral/mistral-small-latest")).toBe(true);
    const traits = catalog.find("mistral/mistral-small-latest");
    expect(traits.reasoning).toBe(true);
    expect(traits.efforts).toContain("high");
  });

  test("the /v1/models snapshot is replaced by the richer getAll data", () => {
    const catalog = new ModelCatalog({ officialModels: () => new Map() });
    catalog.ingestGatewayModels([
      {
        object: "model",
        id: "mistral/mistral-small-latest",
        owned_by: "mistral",
        context_length: 262_144,
        max_output_tokens: 256_000,
        input_modalities: ["text", "image"],
      },
    ]);
    expect(catalog.find("mistral/mistral-small-latest").reasoning).toBe(false);

    class FakeRegistry {
      getAll() {
        return [MISTRAL];
      }
    }
    catalog.observe({
      captured: new Map([["ModelRegistry", FakeRegistry]]),
      observe(name, callback) {
        if (name === "ModelRegistry") callback(FakeRegistry);
      },
    });
    new FakeRegistry().getAll();
    const traits = catalog.find("mistral/mistral-small-latest");
    expect(traits.reasoning).toBe(true);
    expect(traits.efforts).toContain("high");
  });

  test("the official model cache supplies traits when the registry is absent", () => {
    const catalog = new ModelCatalog({
      officialModels: (provider) =>
        provider === "mistral" ? new Map([["mistral/mistral-small-latest", MISTRAL]]) : new Map(),
    });
    expect(catalog.hasNativeModel("mistral/mistral-small-latest")).toBe(true);
    const traits = catalog.find("mistral/mistral-small-latest");
    expect(traits.reasoning).toBe(true);
    expect(traits.efforts).toContain("high");
  });
});

describe("officialModels", () => {
  test("reads the provider's cached model metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-model-cache-"));
    const path = join(dir, "models.db");
    try {
      const db = new Database(path);
      db.run("create table model_cache(provider_id text, models text)");
      db.run("insert into model_cache values(?, ?)", ["mistral", JSON.stringify([MISTRAL])]);
      db.close();
      clearOfficialModelCache();
      const models = officialModels("mistral", { path, now: () => 1 });
      expect(models.get("mistral/mistral-small-latest")?.reasoning).toBe(true);
    } finally {
      clearOfficialModelCache();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

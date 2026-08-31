import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configFromEnv } from "../src/config.js";

describe("configFromEnv", () => {
  let savedBaseUrl: string | undefined;

  beforeEach(() => {
    savedBaseUrl = process.env.AXIOM_API_BASE_URL;
    delete process.env.AXIOM_API_BASE_URL;
  });

  afterEach(() => {
    if (savedBaseUrl === undefined) {
      delete process.env.AXIOM_API_BASE_URL;
    } else {
      process.env.AXIOM_API_BASE_URL = savedBaseUrl;
    }
  });

  it("defaults to the canonical API domain when AXIOM_API_BASE_URL is unset", () => {
    expect(configFromEnv().apiBaseUrl).toBe("https://api.axiom.org");
  });

  it("uses AXIOM_API_BASE_URL when set, stripping trailing slashes", () => {
    process.env.AXIOM_API_BASE_URL = "https://override.example.test/";
    expect(configFromEnv().apiBaseUrl).toBe("https://override.example.test");
  });
});

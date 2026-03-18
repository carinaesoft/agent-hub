import { readFile } from "node:fs/promises";
import path from "node:path";

import { log, readConfig, result } from "../../src/lib/agent-helpers";

interface S01E01Config {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: {
    csvPath: string;
    filterGender: string;
    filterCity: string;
    filterAgeMin: number;
    filterAgeMax: number;
    filterTag: string;
    verifyEndpoint: string;
    verifyTask: string;
    openrouterBaseURL: string;
  };
}

interface Person {
  name: string;
  surname: string;
  gender: string;
  born: number;
  city: string;
  job: string;
  tags?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid string field: ${key}`);
  }

  return value;
}

function getRequiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid number field: ${key}`);
  }

  return value;
}

function getRequiredStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Missing or invalid string array field: ${key}`);
  }

  return value;
}

function getRequiredRecord(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  if (!isRecord(value)) {
    throw new Error(`Missing or invalid object field: ${key}`);
  }

  return value;
}

function parseConfig(rawConfig: unknown): S01E01Config {
  if (!isRecord(rawConfig)) {
    throw new Error("Config must be a JSON object.");
  }

  const params = getRequiredRecord(rawConfig, "params");

  return {
    model: getRequiredString(rawConfig, "model"),
    systemPrompt: getRequiredString(rawConfig, "systemPrompt"),
    temperature: getRequiredNumber(rawConfig, "temperature"),
    maxTokens: getRequiredNumber(rawConfig, "maxTokens"),
    env: getRequiredStringArray(rawConfig, "env"),
    params: {
      csvPath: getRequiredString(params, "csvPath"),
      filterGender: getRequiredString(params, "filterGender"),
      filterCity: getRequiredString(params, "filterCity"),
      filterAgeMin: getRequiredNumber(params, "filterAgeMin"),
      filterAgeMax: getRequiredNumber(params, "filterAgeMax"),
      filterTag: getRequiredString(params, "filterTag"),
      verifyEndpoint: getRequiredString(params, "verifyEndpoint"),
      verifyTask: getRequiredString(params, "verifyTask"),
      openrouterBaseURL: getRequiredString(params, "openrouterBaseURL"),
    },
  };
}

function parsePersonRow(row: unknown, index: number): Person {
  if (!isRecord(row)) {
    throw new Error(`CSV row ${index} is not an object.`);
  }

  const birthDate = getRequiredString(row, "birthDate");
  const birthYearToken = birthDate.split("-")[0];
  const birthYear = Number.parseInt(birthYearToken, 10);
  if (Number.isNaN(birthYear)) {
    throw new Error(`CSV row ${index} has invalid birthDate: ${birthDate}`);
  }

  return {
    name: getRequiredString(row, "name"),
    surname: getRequiredString(row, "surname"),
    gender: getRequiredString(row, "gender"),
    born: birthYear,
    city: getRequiredString(row, "birthPlace"),
    job: getRequiredString(row, "job"),
  };
}

async function loadPeople(csvPath: string): Promise<Person[]> {
  const csvContent = await readFile(csvPath, "utf8");
  const csvParseModule = await import("csv-parse/sync");

  const parsedRows = csvParseModule.parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as unknown;

  if (!Array.isArray(parsedRows)) {
    throw new Error("Parsed CSV payload is not an array.");
  }

  return parsedRows.map((row, index) => parsePersonRow(row, index));
}

interface TagJobsOptions {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  openrouterBaseURL: string;
  openrouterApiKey: string;
}

interface TagResult {
  index: number;
  tags: string[];
}

function parseTagResult(item: unknown, index: number): TagResult {
  if (!isRecord(item)) {
    throw new Error(`Invalid tagging result at index ${index}.`);
  }

  const itemIndex = getRequiredNumber(item, "index");
  const tagsRaw = item.tags;
  if (!Array.isArray(tagsRaw) || !tagsRaw.every((tag) => typeof tag === "string")) {
    throw new Error(`Invalid tags array at result index ${index}.`);
  }

  return {
    index: itemIndex,
    tags: tagsRaw,
  };
}

async function tagJobs(people: Person[], options: TagJobsOptions): Promise<string[][]> {
  if (people.length === 0) {
    return [];
  }

  const openAiModule = await import("openai");
  const client = new openAiModule.default({
    apiKey: options.openrouterApiKey,
    baseURL: options.openrouterBaseURL,
  });

  const jobsPayload = people.map((person, index) => `${index}: ${person.job}`).join("\n");

  const completion = await client.chat.completions.create({
    model: options.model,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    messages: [
      {
        role: "system",
        content: options.systemPrompt,
      },
      {
        role: "user",
        content: jobsPayload,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "tags",
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["index", "tags"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message.content ?? "{}";
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse LLM tagging response as JSON.");
  }

  if (!isRecord(parsedContent) || !Array.isArray(parsedContent.results)) {
    throw new Error("LLM tagging response does not contain a valid results array.");
  }

  return parsedContent.results
    .map((entry, index) => parseTagResult(entry, index))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.tags);
}

async function main(): Promise<void> {
  try {
    const rawConfig = await readConfig<S01E01Config>();
    log("info", "Starting S01E01 — People Filter");

    const config = parseConfig(rawConfig);
    const agentDir = path.dirname(new URL(import.meta.url).pathname);
    const csvFullPath = path.join(agentDir, config.params.csvPath);

    const people = await loadPeople(csvFullPath);
    log("info", `Loaded ${people.length} people`);

    const currentYear = new Date().getUTCFullYear();
    const suspects = people.filter((person) => {
      const age = currentYear - person.born;
      return (
        person.gender === config.params.filterGender &&
        person.city === config.params.filterCity &&
        age >= config.params.filterAgeMin &&
        age <= config.params.filterAgeMax
      );
    });
    log("info", `Suspects matching criteria: ${suspects.length}`);

    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      throw new Error("Missing OPENROUTER_API_KEY environment variable.");
    }

    const tags = await tagJobs(suspects, {
      model: config.model,
      systemPrompt: config.systemPrompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      openrouterBaseURL: config.params.openrouterBaseURL,
      openrouterApiKey,
    });

    tags.forEach((entry, index) => {
      if (!suspects[index]) {
        return;
      }

      suspects[index].tags = entry;
    });

    log("info", `Tagged suspects, filtering by: ${config.params.filterTag}`);
    const finalMatches = suspects.filter((person) =>
      person.tags?.includes(config.params.filterTag),
    );
    log("info", `Final matches: ${finalMatches.length}`);

    const verificationApiKey = process.env.API_KEY;
    if (!verificationApiKey) {
      throw new Error("Missing API_KEY environment variable.");
    }

    const verificationResponse = await fetch(config.params.verifyEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: verificationApiKey,
        task: config.params.verifyTask,
        answer: finalMatches.map((person) => ({
          name: person.name,
          surname: person.surname,
          gender: person.gender,
          born: person.born,
          city: person.city,
          tags: person.tags ?? [],
        })),
      }),
    });

    if (!verificationResponse.ok) {
      throw new Error(`Verification request failed with status ${verificationResponse.status}.`);
    }

    const apiResponse = (await verificationResponse.json()) as unknown;
    log("info", `Verification response: ${JSON.stringify(apiResponse)}`);
    result(apiResponse);
    process.exit(0);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log("error", message);
    process.exit(1);
  }
}

void main();

import { log, readConfig, result } from "../../src/lib/agent-helpers";

interface S01E02Config {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: {
    openrouterBaseURL: string;
    locationEndpoint: string;
    accessLevelEndpoint: string;
    verifyEndpoint: string;
    verifyTask: string;
    suspects: { name: string; surname: string; born: number }[];
    powerPlants: Record<string, { lat: number; lng: number; code: string }>;
  };
}

interface SuspectInput {
  name: string;
  surname: string;
  born: number;
}

interface LocationPoint {
  latitude: number;
  longitude: number;
}

interface SuspectWithLocations extends SuspectInput {
  locations: LocationPoint[];
}

interface PowerPlant {
  lat: number;
  lng: number;
  code: string;
}

interface ToolDefinition {
  type: "function";
  function: {
    name: "get_access_level" | "submit_answer";
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

interface ParsedToolCall {
  id: string;
  name: "get_access_level" | "submit_answer";
  argumentsJson: string;
}

interface ParsedAssistantMessage {
  rawMessage: Record<string, unknown>;
  content: string;
  toolCalls: ParsedToolCall[];
}

interface OpenAICompletionsClient {
  create: (payload: {
    model: string;
    temperature: number;
    max_tokens: number;
    messages: Array<Record<string, unknown>>;
    tools: ToolDefinition[];
  }) => Promise<unknown>;
}

interface OpenAIChatClient {
  completions: OpenAICompletionsClient;
}

interface OpenAIClient {
  chat: OpenAIChatClient;
}

interface OpenAIConstructor {
  new (options: { apiKey: string; baseURL: string }): OpenAIClient;
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

function parseSuspects(input: unknown): SuspectInput[] {
  if (!Array.isArray(input)) {
    throw new Error("Missing or invalid suspects array.");
  }

  return input.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid suspect at index ${index}.`);
    }

    return {
      name: getRequiredString(item, "name"),
      surname: getRequiredString(item, "surname"),
      born: getRequiredNumber(item, "born"),
    };
  });
}

function parsePowerPlants(input: unknown): Record<string, PowerPlant> {
  if (!isRecord(input)) {
    throw new Error("Missing or invalid powerPlants map.");
  }

  const plants: Record<string, PowerPlant> = {};
  for (const [plantName, rawPlant] of Object.entries(input)) {
    if (!isRecord(rawPlant)) {
      throw new Error(`Invalid power plant entry: ${plantName}`);
    }

    plants[plantName] = {
      lat: getRequiredNumber(rawPlant, "lat"),
      lng: getRequiredNumber(rawPlant, "lng"),
      code: getRequiredString(rawPlant, "code"),
    };
  }

  return plants;
}

function parseConfig(rawConfig: unknown): S01E02Config {
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
      openrouterBaseURL: getRequiredString(params, "openrouterBaseURL"),
      locationEndpoint: getRequiredString(params, "locationEndpoint"),
      accessLevelEndpoint: getRequiredString(params, "accessLevelEndpoint"),
      verifyEndpoint: getRequiredString(params, "verifyEndpoint"),
      verifyTask: getRequiredString(params, "verifyTask"),
      suspects: parseSuspects(params.suspects),
      powerPlants: parsePowerPlants(params.powerPlants),
    },
  };
}

function extractCoordinate(
  location: Record<string, unknown>,
  primaryKey: string,
  fallbackKey: string,
): number {
  const value = location[primaryKey] ?? location[fallbackKey];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  throw new Error(`Invalid coordinate value for keys '${primaryKey}'/'${fallbackKey}'.`);
}

function parseLocations(payload: unknown): LocationPoint[] {
  const rawLocations = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.locations)
      ? payload.locations
      : null;

  if (!rawLocations) {
    throw new Error("Location API response does not contain a locations array.");
  }

  return rawLocations.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid location entry at index ${index}.`);
    }

    return {
      latitude: extractCoordinate(item, "latitude", "lat"),
      longitude: extractCoordinate(item, "longitude", "lng"),
    };
  });
}

async function postJson(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Request to ${endpoint} failed with status ${response.status}.`);
  }

  return (await response.json()) as unknown;
}

async function getPersonLocations(
  endpoint: string,
  apiKey: string,
  name: string,
  surname: string,
): Promise<LocationPoint[]> {
  const response = await postJson(endpoint, { apikey: apiKey, name, surname });
  return parseLocations(response);
}

async function getAccessLevel(
  endpoint: string,
  apiKey: string,
  name: string,
  surname: string,
  birthYear: number,
): Promise<unknown> {
  return postJson(endpoint, { apikey: apiKey, name, surname, birthYear });
}

async function submitAnswer(
  endpoint: string,
  apiKey: string,
  task: string,
  name: string,
  surname: string,
  accessLevel: number,
  powerPlant: string,
): Promise<unknown> {
  return postJson(endpoint, {
    apikey: apiKey,
    task,
    answer: { name, surname, accessLevel, powerPlant },
  });
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOpenAIConstructor(moduleValue: unknown): OpenAIConstructor {
  if (!isRecord(moduleValue) || typeof moduleValue.default !== "function") {
    throw new Error("Failed to load OpenAI client constructor.");
  }

  return moduleValue.default as unknown as OpenAIConstructor;
}

function parseAssistantMessage(payload: unknown): ParsedAssistantMessage {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("OpenAI response does not contain choices.");
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("OpenAI response choice does not contain a valid message.");
  }

  const rawMessage = firstChoice.message;
  const content = typeof rawMessage.content === "string" ? rawMessage.content : "";

  const toolCalls: ParsedToolCall[] = [];
  if (Array.isArray(rawMessage.tool_calls)) {
    for (const toolCall of rawMessage.tool_calls) {
      if (!isRecord(toolCall) || toolCall.type !== "function" || !isRecord(toolCall.function)) {
        continue;
      }

      const toolCallId = getRequiredString(toolCall, "id");
      const toolName = getRequiredString(toolCall.function, "name");
      const argumentsJson = getRequiredString(toolCall.function, "arguments");

      if (toolName !== "get_access_level" && toolName !== "submit_answer") {
        continue;
      }

      toolCalls.push({
        id: toolCallId,
        name: toolName,
        argumentsJson,
      });
    }
  }

  return { rawMessage, content, toolCalls };
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw new Error(`Invalid tool arguments JSON: ${argumentsJson}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  return parsed;
}

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_access_level",
      description: "Fetches a person's access level in the system.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          surname: { type: "string" },
          birthYear: { type: "number" },
        },
        required: ["name", "surname", "birthYear"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submits the final answer for verification.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          surname: { type: "string" },
          accessLevel: { type: "number" },
          powerPlant: { type: "string" },
        },
        required: ["name", "surname", "accessLevel", "powerPlant"],
      },
    },
  },
];

async function main(): Promise<void> {
  try {
    const rawConfig = await readConfig<S01E02Config>();
    log("info", "Starting S01E02 — Find Him");
    const config = parseConfig(rawConfig);

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("Missing API_KEY environment variable.");
    }

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      throw new Error("Missing OPENROUTER_API_KEY environment variable.");
    }

    const suspects: SuspectWithLocations[] = config.params.suspects.map((suspect) => ({
      ...suspect,
      locations: [],
    }));

    for (const suspect of suspects) {
      suspect.locations = await getPersonLocations(
        config.params.locationEndpoint,
        apiKey,
        suspect.name,
        suspect.surname,
      );

      log(
        "info",
        `Fetched locations for ${suspect.name} ${suspect.surname}: ${suspect.locations.length} points`,
      );
    }

    let closestSuspect: SuspectWithLocations | null = null;
    let closestPlantName: string | null = null;
    let closestPlantCode: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const suspect of suspects) {
      for (const location of suspect.locations) {
        for (const [plantName, plant] of Object.entries(config.params.powerPlants)) {
          const distance = haversine(location.latitude, location.longitude, plant.lat, plant.lng);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestSuspect = suspect;
            closestPlantName = plantName;
            closestPlantCode = plant.code;
          }
        }
      }
    }

    if (!closestSuspect || !closestPlantName || !closestPlantCode) {
      throw new Error("Unable to determine closest suspect to a power plant.");
    }

    log(
      "info",
      `Closest: ${closestSuspect.name} ${closestSuspect.surname} to ${closestPlantName} (${closestDistance.toFixed(2)} km)`,
    );

    const openAiModule = await import("openai");
    const OpenAI = getOpenAIConstructor(openAiModule);
    const openAIClient = new OpenAI({
      apiKey: openRouterApiKey,
      baseURL: config.params.openrouterBaseURL,
    });

    const messages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: `${config.systemPrompt}\nSuspect: ${JSON.stringify(closestSuspect)}\nPower plant: ${JSON.stringify({ name: closestPlantName, code: closestPlantCode })}`,
      },
      {
        role: "user",
        content: "Fetch access level and submit the answer.",
      },
    ];

    const finalData: unknown = {
      suspect: closestSuspect,
      plant: { name: closestPlantName, code: closestPlantCode, distanceKm: closestDistance },
      agentMessage: "",
      submissionResponse: null,
    };

    for (let iteration = 0; iteration < 10; iteration += 1) {
      const completion = await openAIClient.chat.completions.create({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages,
        tools,
      });

      const assistantMessage = parseAssistantMessage(completion);
      messages.push(assistantMessage.rawMessage);

      if (assistantMessage.toolCalls.length === 0) {
        log("info", `Agent finished: ${assistantMessage.content}`);
        if (isRecord(finalData)) {
          finalData.agentMessage = assistantMessage.content;
        }
        break;
      }

      for (const toolCall of assistantMessage.toolCalls) {
        const args = parseToolArguments(toolCall.argumentsJson);
        log("info", `Tool call: ${toolCall.name} ${JSON.stringify(args)}`);

        let toolResult: unknown;

        if (toolCall.name === "get_access_level") {
          const name = getRequiredString(args, "name");
          const surname = getRequiredString(args, "surname");
          const birthYear = getRequiredNumber(args, "birthYear");
          toolResult = await getAccessLevel(
            config.params.accessLevelEndpoint,
            apiKey,
            name,
            surname,
            birthYear,
          );
        } else {
          const name = getRequiredString(args, "name");
          const surname = getRequiredString(args, "surname");
          const accessLevel = getRequiredNumber(args, "accessLevel");
          const powerPlant = getRequiredString(args, "powerPlant");
          toolResult = await submitAnswer(
            config.params.verifyEndpoint,
            apiKey,
            config.params.verifyTask,
            name,
            surname,
            accessLevel,
            powerPlant,
          );
          if (isRecord(finalData)) {
            finalData.submissionResponse = toolResult;
          }
        }

        log("info", `Tool result: ${JSON.stringify(toolResult)}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    result(finalData);
    process.exit(0);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log("error", message);
    process.exit(1);
  }
}

void main();

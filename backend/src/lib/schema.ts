import type { APIGatewayProxyEventV2 } from "aws-lambda";

export type JsonSchema =
  | {
      type: "string";
      minLength?: number;
      maxLength?: number;
      enum?: ReadonlyArray<string>;
      nullable?: boolean;
    }
  | {
      type: "number";
      minimum?: number;
      maximum?: number;
      nullable?: boolean;
    }
  | {
      type: "integer";
      minimum?: number;
      maximum?: number;
      nullable?: boolean;
    }
  | {
      type: "boolean";
      nullable?: boolean;
    }
  | {
      type: "array";
      items?: JsonSchema;
      minItems?: number;
      maxItems?: number;
      nullable?: boolean;
    }
  | {
      type: "object";
      properties?: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
      nullable?: boolean;
    };

export function parseJsonRequestBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) {
    throw new Error("Request body is required.");
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error("Request body must be valid JSON.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableAllowed(schema: JsonSchema, value: unknown): boolean {
  return value === null && Boolean(schema.nullable);
}

function validateObject(
  schema: Extract<JsonSchema, { type: "object" }>,
  value: unknown,
  path: string,
): string[] {
  const issues: string[] = [];

  if (isNullableAllowed(schema, value)) {
    return issues;
  }

  if (!isPlainObject(value)) {
    return [`${path} must be an object.`];
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  required.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push(`${path}.${key} is required.`);
    }
  });

  const properties = schema.properties || {};
  for (const [key, fieldSchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }

    const nested = validateSchema(fieldSchema, value[key], `${path}.${key}`);
    issues.push(...nested);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        issues.push(`${path}.${key} is not allowed.`);
      }
    }
  }

  return issues;
}

function validateArray(
  schema: Extract<JsonSchema, { type: "array" }>,
  value: unknown,
  path: string,
): string[] {
  const issues: string[] = [];

  if (isNullableAllowed(schema, value)) {
    return issues;
  }

  if (!Array.isArray(value)) {
    return [`${path} must be an array.`];
  }

  if (schema.minItems != null && value.length < schema.minItems) {
    issues.push(`${path} must include at least ${schema.minItems} items.`);
  }

  if (schema.maxItems != null && value.length > schema.maxItems) {
    issues.push(`${path} cannot include more than ${schema.maxItems} items.`);
  }

  if (schema.items) {
    value.forEach((item, index) => {
      const nested = validateSchema(schema.items as JsonSchema, item, `${path}[${index}]`);
      issues.push(...nested);
    });
  }

  return issues;
}

function validateString(
  schema: Extract<JsonSchema, { type: "string" }>,
  value: unknown,
  path: string,
): string[] {
  if (isNullableAllowed(schema, value)) {
    return [];
  }

  if (typeof value !== "string") {
    return [`${path} must be a string.`];
  }

  const issues: string[] = [];
  if (schema.minLength != null && value.length < schema.minLength) {
    issues.push(`${path} must be at least ${schema.minLength} characters.`);
  }

  if (schema.maxLength != null && value.length > schema.maxLength) {
    issues.push(`${path} must be ${schema.maxLength} characters or less.`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(`${path} must be one of: ${schema.enum.join(", ")}.`);
  }

  return issues;
}

function validateNumber(
  schema: Extract<JsonSchema, { type: "number" | "integer" }>,
  value: unknown,
  path: string,
): string[] {
  if (isNullableAllowed(schema, value)) {
    return [];
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [`${path} must be a number.`];
  }

  if (schema.type === "integer" && !Number.isInteger(value)) {
    return [`${path} must be an integer.`];
  }

  const issues: string[] = [];
  if (schema.minimum != null && value < schema.minimum) {
    issues.push(`${path} must be greater than or equal to ${schema.minimum}.`);
  }

  if (schema.maximum != null && value > schema.maximum) {
    issues.push(`${path} must be less than or equal to ${schema.maximum}.`);
  }

  return issues;
}

function validateBoolean(
  schema: Extract<JsonSchema, { type: "boolean" }>,
  value: unknown,
  path: string,
): string[] {
  if (isNullableAllowed(schema, value)) {
    return [];
  }

  if (typeof value !== "boolean") {
    return [`${path} must be a boolean.`];
  }

  return [];
}

export function validateSchema(schema: JsonSchema, value: unknown, path = "body"): string[] {
  if (schema.type === "object") {
    return validateObject(schema, value, path);
  }

  if (schema.type === "array") {
    return validateArray(schema, value, path);
  }

  if (schema.type === "string") {
    return validateString(schema, value, path);
  }

  if (schema.type === "number" || schema.type === "integer") {
    return validateNumber(schema, value, path);
  }

  return validateBoolean(schema, value, path);
}

import { z } from "zod";

// Convert Zod schema to JSON Schema
export function zodToJsonSchema(schema: z.ZodType): Record<string, any> {
  const jsonSchema: Record<string, any> = {
    type: "object",
    properties: {},
    required: [],
  };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType;
      const propertySchema = zodTypeToJsonSchema(zodValue);
      jsonSchema.properties[key] = propertySchema;
      // Check if required (optional, default and similar wrappers are not required)
      if (!zodValue.isOptional()) {
        jsonSchema.required.push(key);
      }
    }
  }
  if (jsonSchema.required.length === 0) {
    delete jsonSchema.required;
  }
  return jsonSchema;
}

export function zodTypeToJsonSchema(zodType: z.ZodType): Record<string, any> {
  // Handle optional, nullable and default wrappers
  if (
    zodType instanceof z.ZodOptional ||
    zodType instanceof z.ZodNullable ||
    zodType instanceof z.ZodDefault
  ) {
    const inner = zodTypeToJsonSchema(zodType._def.innerType);
    if (zodType.description && !inner.description) {
      inner.description = zodType.description;
    }
    return inner;
  }
  // Handle nested object
  if (zodType instanceof z.ZodObject) {
    const schema = zodToJsonSchema(zodType);
    if (zodType.description) {
      schema.description = zodType.description;
    }
    return schema;
  }
  // Handle string
  if (zodType instanceof z.ZodString) {
    const schema: Record<string, any> = { type: "string" };
    if (zodType.description) {
      schema.description = zodType.description;
    }
    return schema;
  }
  // Handle number
  if (zodType instanceof z.ZodNumber) {
    const schema: Record<string, any> = { type: "number" };
    if (zodType.description) {
      schema.description = zodType.description;
    }
    return schema;
  }
  // Handle boolean
  if (zodType instanceof z.ZodBoolean) {
    const schema: Record<string, any> = { type: "boolean" };
    if (zodType.description) {
      schema.description = zodType.description;
    }
    return schema;
  }
  // Handle enum
  if (zodType instanceof z.ZodEnum) {
    const schema: Record<string, any> = {
      type: "string",
      enum: zodType._def.values,
    };
    if (zodType.description) {
      schema.description = zodType.description;
    }
    return schema;
  }
  // Handle array
  if (zodType instanceof z.ZodArray) {
    const schema: Record<string, any> = {
      type: "array",
      items: zodTypeToJsonSchema(zodType._def.type),
    };
    if (zodType.description) {
      schema.description = zodType.description;
    }
    return schema;
  }
  // Default fallback
  return { type: "string" };
}

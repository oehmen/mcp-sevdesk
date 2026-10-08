import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../src/json-schema.js";
import { invoiceTools } from "../src/tools/invoices.js";
import { offerTools } from "../src/tools/offers.js";

describe("zodToJsonSchema", () => {
  it("sollte nur Pflichtfelder als required markieren", () => {
    const schema = zodToJsonSchema(
      z.object({ name: z.string(), note: z.string().optional() })
    );
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["name"]);
    expect(schema.properties.note.type).toBe("string");
  });

  it("sollte verschachtelte Objekte in Arrays abbilden", () => {
    const schema = zodToJsonSchema(
      z.object({ items: z.array(z.object({ a: z.number(), b: z.string().optional() })) })
    );
    expect(schema.properties.items.type).toBe("array");
    expect(schema.properties.items.items.type).toBe("object");
    expect(schema.properties.items.items.properties.a.type).toBe("number");
    expect(schema.properties.items.items.properties.b.type).toBe("string");
    expect(schema.properties.items.items.required).toEqual(["a"]);
  });

  it("sollte das Schema von list_invoices unverändert abbilden", () => {
    const schema = zodToJsonSchema(invoiceTools.list_invoices.inputSchema);
    expect(schema.type).toBe("object");
    expect(schema.properties.status.type).toBe("string");
    expect(schema.properties.status.enum).toEqual(["100", "200", "1000"]);
    expect(schema).not.toHaveProperty("required");
  });

  it("sollte Positionen von create_offer als Objekte ausweisen", () => {
    const schema = zodToJsonSchema(offerTools.create_offer.inputSchema);
    const items = schema.properties.positions.items;
    expect(items.type).toBe("object");
    expect(items.properties.unityId.type).toBe("number");
    expect(items.required).toEqual(expect.arrayContaining(["name", "quantity", "price", "unityId", "taxRate"]));
    expect(schema.properties).not.toHaveProperty("status");
    expect(schema.properties).not.toHaveProperty("orderNumber");
    expect(schema.properties).not.toHaveProperty("orderType");
  });
});

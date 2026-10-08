import { z } from "zod";
import type { SevdeskClient } from "../client.js";

/**
 * Draft-only offer tools (Angebote, orderType "AN").
 *
 * These tools can list, read, create and update offers. Writes always produce
 * or keep status 100 (draft). There is deliberately no code path for sending,
 * status transitions, conversion to other documents or deletion: those stay
 * manual in sevDesk.
 */

/** Allowed position taxRate values per sevDesk taxRule (sevdesk-Update 2.0). Rule 8 ("varies") is excluded. */
export const OFFER_TAX_RULES = {
  "1": [0, 7, 19],
  "2": [0],
  "3": [0],
  "4": [0],
  "5": [0],
  "11": [0],
} as const satisfies Record<string, readonly number[]>;

export type OfferTaxRule = keyof typeof OFFER_TAX_RULES;

const TAX_RULE_IDS = Object.keys(OFFER_TAX_RULES) as [OfferTaxRule, ...OfferTaxRule[]];

/** SevUser id of the default contact person (Johannes Oehmen). */
export const DEFAULT_CONTACT_PERSON_ID = 389230;

export const OFFER_UNITY_HINT = "Unity id: 1=Stk, 7=pauschal, 9=Std, 13=Tag(e)";

const DRAFT_NOTE = "Draft (status 100). Review and send manually in sevDesk.";

const DRAFT_ONLY_TEXT =
  "Draft only: creates/updates offers in status 100. Sending, status changes, conversion and deletion are not available and stay manual in sevDesk.";

/** `/SevSequence/Factory/getByType` is not in the OpenAPI spec, so it needs an untyped call. */
type UntypedGet = (
  path: string,
  init?: { params?: { query?: Record<string, unknown> } }
) => Promise<{ data?: any; error?: unknown }>;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const positionSchema = z
  .object({
    name: z.string().min(1).describe("Position title"),
    text: z.string().optional().describe("Position description (may contain line breaks)"),
    quantity: z.number().positive().describe("Quantity, must be greater than 0"),
    price: z.number().nonnegative().describe("Net unit price"),
    unityId: z.number().int().positive().describe(OFFER_UNITY_HINT),
    taxRate: z.number().describe("Tax rate in percent; must be allowed by the offer's taxRule"),
    partId: z.number().int().positive().optional().describe("Optional sevDesk Part id"),
  })
  .strict();

const updatePositionSchema = positionSchema
  .extend({
    id: z.number().int().positive().optional().describe("Id of an existing position of this offer; omit to add a new position"),
    positionNumber: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Position number (0-based); existing positions keep their number, new positions continue after the highest number"),
  })
  .strict();

export type OfferPositionInput = z.infer<typeof updatePositionSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

const taxRuleSchema = z
  .enum(TAX_RULE_IDS)
  .describe("Tax rule: 1=domestic (0/7/19), 2=export non-EU, 3=EU delivery, 4=§4 UStG exempt, 5=reverse charge §13b, 11=§19 UStG (all 0)");

const createOfferSchema = z
  .object({
    contactId: z.number().int().positive().describe("sevDesk Contact id of the customer"),
    orderDate: isoDate.optional().describe("Offer date (YYYY-MM-DD), defaults to today"),
    header: z.string().min(1).describe("Offer header / title"),
    headText: z.string().optional().describe("Intro text"),
    footText: z.string().optional().describe("Closing text"),
    address: z.string().optional().describe("Address block (lines separated by \\n)"),
    addressCountryId: z.number().int().positive().describe("StaticCountry id: 1=DE, 13=UK, 33=US, 47=ZA"),
    deliveryTerms: z.string().optional().describe("Delivery terms"),
    paymentTerms: z.string().optional().describe("Payment terms"),
    currency: z.string().length(3).optional().describe("ISO currency code, defaults to EUR"),
    taxRule: taxRuleSchema,
    taxText: z.string().min(1).describe("Tax text, e.g. 'Steuerfrei - Ausfuhrlieferung'"),
    contactPersonId: z.number().int().positive().optional().describe("SevUser id of the contact person; defaults to SEVDESK_CONTACT_PERSON_ID or 389230"),
    positions: z.array(positionSchema).min(1).describe("Offer positions (at least one)"),
  })
  .strict();

export type CreateOfferInput = z.infer<typeof createOfferSchema>;

const updateOfferSchema = z
  .object({
    orderId: z.number().int().positive().describe("Id of the draft offer to update"),
    contactId: z.number().int().positive().optional().describe("sevDesk Contact id of the customer"),
    orderDate: isoDate.optional().describe("Offer date (YYYY-MM-DD)"),
    header: z.string().min(1).optional().describe("Offer header / title"),
    headText: z.string().optional().describe("Intro text"),
    footText: z.string().optional().describe("Closing text"),
    address: z.string().optional().describe("Address block (lines separated by \\n)"),
    addressCountryId: z.number().int().positive().optional().describe("StaticCountry id: 1=DE, 13=UK, 33=US, 47=ZA"),
    deliveryTerms: z.string().optional().describe("Delivery terms"),
    paymentTerms: z.string().optional().describe("Payment terms"),
    currency: z.string().length(3).optional().describe("ISO currency code"),
    taxRule: taxRuleSchema.optional(),
    taxText: z.string().min(1).optional().describe("Tax text"),
    contactPersonId: z.number().int().positive().optional().describe("SevUser id of the contact person"),
    positions: z
      .array(updatePositionSchema)
      .min(1)
      .optional()
      .describe("Positions to save; include id to change an existing position, omit id to add one. Positions are never deleted."),
  })
  .strict();

export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts `YYYY-MM-DD` to sevDesk's `DD.MM.YYYY`. */
export function toSevdeskDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid date '${iso}', expected YYYY-MM-DD`);
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function todaySevdeskDate(now: Date = new Date()): string {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${now.getFullYear()}`;
}

/** Fetches the next offer number from sevDesk and formats it (e.g. `AN-2026-1281`). Never invents a number. */
export async function fetchNextOfferNumber(client: SevdeskClient, now: Date = new Date()): Promise<string> {
  const { data, error } = await (client.GET as unknown as UntypedGet)("/SevSequence/Factory/getByType", {
    params: { query: { objectType: "Order", type: "AN" } },
  });
  if (error) throw new Error(JSON.stringify(error));
  const nextSequence = data?.objects?.nextSequence;
  if (nextSequence === undefined || nextSequence === null || nextSequence === "") {
    throw new Error("sevDesk did not return a next offer sequence number");
  }
  const year = String(now.getFullYear());
  const format: unknown = data?.objects?.format;
  if (typeof format !== "string" || format.length === 0) {
    return `AN-${year}-${nextSequence}`;
  }
  const formatted = format
    .replace(/%YYYY/g, year)
    .replace(/%YY/g, year.slice(-2))
    .replace(/%NUMBER/g, String(nextSequence));
  if (formatted.includes("%")) {
    throw new Error(`Unsupported offer number format '${format}'`);
  }
  return formatted;
}

/** Loads an order and asserts it is an offer (orderType "AN"). */
async function loadOffer(client: SevdeskClient, orderId: number): Promise<any> {
  const { data, error } = await client.GET("/Order/{orderId}", {
    params: { path: { orderId } },
  });
  if (error) throw new Error(JSON.stringify(error));
  const offer: any = (data as any)?.objects?.[0];
  if (!offer) throw new Error(`Offer ${orderId} not found`);
  if (offer.orderType !== "AN") {
    throw new Error(`Order ${orderId} is not an offer (orderType ${offer.orderType})`);
  }
  return offer;
}

async function loadPositions(client: SevdeskClient, orderId: number): Promise<any[]> {
  const { data, error } = await client.GET("/Order/{orderId}/getPositions", {
    params: { path: { orderId }, query: { limit: 1000 } },
  });
  if (error) throw new Error(JSON.stringify(error));
  return ((data as any)?.objects ?? []) as any[];
}

/** Rejects an empty position list and positions without unity. Also enforced by zod; repeated here for direct handler calls. */
function assertPositions(positions: ReadonlyArray<{ unityId?: number; quantity?: number }> | undefined): void {
  if (!Array.isArray(positions) || positions.length === 0) {
    throw new Error("An offer needs at least one position");
  }
  positions.forEach((p, i) => {
    if (typeof p.unityId !== "number" || !(p.unityId > 0)) {
      throw new Error(`Position ${i} has no unityId (${OFFER_UNITY_HINT})`);
    }
    if (typeof p.quantity !== "number" || !(p.quantity > 0)) {
      throw new Error(`Position ${i} needs a quantity greater than 0`);
    }
  });
}

/** Rejects a taxRule/taxRate combination that the sevDesk tax table does not allow. */
export function assertTaxRates(taxRule: string, positions: ReadonlyArray<{ taxRate: number }>): void {
  if (!Object.prototype.hasOwnProperty.call(OFFER_TAX_RULES, taxRule)) {
    throw new Error(`taxRule ${taxRule} is not supported; allowed rules: ${TAX_RULE_IDS.join(", ")}`);
  }
  const allowed: readonly number[] = OFFER_TAX_RULES[taxRule as OfferTaxRule];
  positions.forEach((p, i) => {
    if (!allowed.includes(Number(p.taxRate))) {
      throw new Error(
        `Position ${i}: taxRate ${p.taxRate} is not allowed for taxRule ${taxRule}; allowed values: ${allowed.join(", ")}`
      );
    }
  });
}

/**
 * Position numbers for update_offer. A position with an id keeps its current
 * number; a new position continues after the highest number already in use.
 * An explicit positionNumber from the caller always wins.
 */
function resolvePositionNumbers(submitted: ReadonlyArray<OfferPositionInput>, existing: ReadonlyArray<any>): number[] {
  const currentById = new Map<number, number>();
  for (const pos of existing) {
    const n = Number(pos?.positionNumber);
    if (pos?.positionNumber !== undefined && pos?.positionNumber !== null && pos?.positionNumber !== "" && Number.isInteger(n)) {
      currentById.set(Number(pos.id), n);
    }
  }
  let highest = Math.max(
    -1,
    ...currentById.values(),
    ...submitted.filter((p) => p.positionNumber !== undefined).map((p) => p.positionNumber as number)
  );
  return submitted.map((p) => {
    if (p.positionNumber !== undefined) return p.positionNumber;
    if (p.id !== undefined && currentById.has(Number(p.id))) return currentById.get(Number(p.id)) as number;
    highest += 1;
    return highest;
  });
}

/**
 * On a taxRule change, every position the offer ends up with must fit the new
 * rule. Submitted positions are checked by assertTaxRates; existing positions
 * not in the submitted list keep their stored rate, so the tool refuses
 * instead of rewriting them.
 */
function assertTaxRuleChange(
  taxRule: OfferTaxRule,
  submitted: ReadonlyArray<OfferPositionInput>,
  existing: ReadonlyArray<any>
): void {
  const submittedIds = new Set(submitted.filter((p) => p.id !== undefined).map((p) => Number(p.id)));
  const allowed: readonly number[] = OFFER_TAX_RULES[taxRule];
  const mismatched = existing.filter((pos) => !submittedIds.has(Number(pos?.id)) && !allowed.includes(Number(pos?.taxRate)));
  if (mismatched.length > 0) {
    const list = mismatched
      .map((pos) => `id ${pos.id}${pos.name ? ` '${pos.name}'` : ""} (taxRate ${pos.taxRate})`)
      .join(", ");
    throw new Error(
      `Cannot change taxRule to ${taxRule}: existing position(s) ${list} have a taxRate that is not allowed for taxRule ${taxRule} (allowed: ${allowed.join(", ")}). Resubmit those positions with their id and an allowed taxRate in the same call.`
    );
  }
}

function toOrderPos(p: OfferPositionInput, positionNumber: number): Record<string, unknown> {
  const pos: Record<string, unknown> = {
    objectName: "OrderPos",
    mapAll: true,
    part: p.partId ? { id: p.partId, objectName: "Part" } : null,
    quantity: p.quantity,
    price: String(p.price),
    name: p.name,
    text: p.text ?? "",
    unity: { id: p.unityId, objectName: "Unity" },
    positionNumber,
    discount: 0,
    optional: false,
    taxRate: p.taxRate,
  };
  if (p.id !== undefined) pos.id = p.id;
  return pos;
}

function resolveContactPersonId(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env.SEVDESK_CONTACT_PERSON_ID;
  if (fromEnv !== undefined && fromEnv !== "") {
    const id = Number(fromEnv);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("SEVDESK_CONTACT_PERSON_ID must be a positive integer");
    }
    return id;
  }
  return DEFAULT_CONTACT_PERSON_ID;
}

async function saveOrder(client: SevdeskClient, body: Record<string, unknown>) {
  const { data, error } = await client.POST("/Order/Factory/saveOrder", {
    body: body as any,
  });
  if (error) throw new Error(JSON.stringify(error));
  const objects: any = (data as any)?.objects ?? {};
  return { offer: objects.order, positions: objects.orderPos, note: DRAFT_NOTE };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const offerTools = {
  list_offers: {
    description: "List offers (Angebote, orderType AN) from sevdesk. Read-only. Supports filtering and pagination.",
    inputSchema: z
      .object({
        limit: z.number().int().min(1).max(100).optional().describe("Maximum number of results (default 20, max 100)"),
        offset: z.number().int().min(0).optional().describe("Skip a number of results"),
        contactId: z.number().int().positive().optional().describe("Only offers for this Contact id"),
        status: z
          .enum(["100", "200", "300", "500", "1000"])
          .optional()
          .describe("Offer status: 100=Draft, 200=Sent, 300=Rejected, 500=Accepted, 1000=Done"),
        orderNumber: z.string().optional().describe("Filter by offer number, e.g. AN-2026-1281"),
      })
      .strict(),
    handler: async (client: SevdeskClient, params: {
      limit?: number;
      offset?: number;
      contactId?: number;
      status?: "100" | "200" | "300" | "500" | "1000";
      orderNumber?: string;
    }) => {
      const { data, error } = await client.GET("/Order", {
        params: {
          query: {
            orderType: "AN",
            limit: params.limit ?? 20,
            offset: params.offset,
            status: params.status ? Number(params.status) : undefined,
            orderNumber: params.orderNumber,
            "contact[id]": params.contactId,
            "contact[objectName]": params.contactId ? "Contact" : undefined,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      const orders: any[] = ((data as any)?.objects ?? []) as any[];
      return {
        offers: orders
          .filter((o) => o?.orderType === "AN")
          .map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            contact: o.contact ? { id: o.contact.id, objectName: o.contact.objectName } : null,
            orderDate: o.orderDate,
            status: o.status,
            header: o.header,
            sumNet: o.sumNet,
          })),
      };
    },
  },

  get_offer: {
    description: "Get a specific offer (orderType AN) and its positions from sevdesk. Read-only. Rejects orders that are not offers.",
    inputSchema: z
      .object({
        orderId: z.number().int().positive().describe("The ID of the offer"),
      })
      .strict(),
    handler: async (client: SevdeskClient, params: { orderId: number }) => {
      const offer = await loadOffer(client, params.orderId);
      const positions = await loadPositions(client, params.orderId);
      return { offer, positions };
    },
  },

  create_offer: {
    description: `Create a new offer (Angebot, orderType AN) in sevdesk. The offer number is fetched from sevDesk. ${DRAFT_ONLY_TEXT}`,
    inputSchema: createOfferSchema,
    handler: async (client: SevdeskClient, params: CreateOfferInput) => {
      // Guards run before any API call.
      assertPositions(params.positions);
      assertTaxRates(params.taxRule, params.positions);
      const contactPersonId = resolveContactPersonId(params.contactPersonId);

      const orderNumber = await fetchNextOfferNumber(client);

      // Built field by field: caller input can never set status, orderType or orderNumber.
      const order: Record<string, unknown> = {
        id: null,
        objectName: "Order",
        mapAll: true,
        orderNumber,
        contact: { id: params.contactId, objectName: "Contact" },
        orderDate: params.orderDate ? toSevdeskDate(params.orderDate) : todaySevdeskDate(),
        status: 100,
        header: params.header,
        headText: params.headText,
        footText: params.footText,
        addressCountry: { id: params.addressCountryId, objectName: "StaticCountry" },
        deliveryTerms: params.deliveryTerms,
        paymentTerms: params.paymentTerms,
        version: 0,
        smallSettlement: 0,
        contactPerson: { id: contactPersonId, objectName: "SevUser" },
        taxRate: Math.max(...params.positions.map((p) => p.taxRate)),
        taxText: params.taxText,
        taxRule: { id: params.taxRule, objectName: "TaxRule" },
        orderType: "AN",
        currency: params.currency ?? "EUR",
        showNet: 1,
        sendType: "VPR",
      };
      if (params.address !== undefined) order.address = params.address;

      return saveOrder(client, {
        order,
        orderPosSave: params.positions.map((p, i) => toOrderPos(p, i)),
        orderPosDelete: null,
      });
    },
  },

  update_offer: {
    description: `Update a draft offer (status 100) in sevdesk. Refuses offers that are not drafts. Offer number, type and status cannot be changed; positions are added or changed, never deleted. ${DRAFT_ONLY_TEXT}`,
    inputSchema: updateOfferSchema,
    handler: async (client: SevdeskClient, params: UpdateOfferInput) => {
      const { orderId, ...changes } = params;
      if (Object.values(changes).every((v) => v === undefined)) {
        throw new Error("Nothing to update");
      }

      const current = await loadOffer(client, orderId);
      if (String(current.status) !== "100") {
        throw new Error(
          `Offer ${current.orderNumber} (id ${current.id}) has status ${current.status}; only draft offers (status 100) can be updated. Change it manually in sevDesk.`
        );
      }

      const effectiveTaxRule = params.taxRule ?? String(current.taxRule?.id);
      let positionNumbers: number[] = [];
      if (params.positions) {
        assertPositions(params.positions);
        assertTaxRates(effectiveTaxRule, params.positions);
      }
      if (params.positions || params.taxRule !== undefined) {
        const existing = await loadPositions(client, orderId);
        if (params.positions) {
          const existingIds = new Set(existing.map((p) => Number(p.id)));
          const foreign = params.positions
            .filter((p) => p.id !== undefined)
            .map((p) => Number(p.id))
            .filter((id) => !existingIds.has(id));
          if (foreign.length > 0) {
            throw new Error(`Position id(s) ${foreign.join(", ")} do not belong to offer ${orderId}`);
          }
          positionNumbers = resolvePositionNumbers(params.positions, existing);
        }
        if (params.taxRule !== undefined) {
          // The positions the offer ends up with must all fit the new rule.
          assertTaxRuleChange(params.taxRule, params.positions ?? [], existing);
        }
      }

      // Built field by field: status stays 100, orderType and orderNumber stay as they are.
      const order: Record<string, unknown> = {
        id: orderId,
        objectName: "Order",
        mapAll: true,
        orderNumber: current.orderNumber,
        orderType: "AN",
        status: 100,
      };
      if (params.contactId !== undefined) order.contact = { id: params.contactId, objectName: "Contact" };
      if (params.orderDate !== undefined) order.orderDate = toSevdeskDate(params.orderDate);
      if (params.header !== undefined) order.header = params.header;
      if (params.headText !== undefined) order.headText = params.headText;
      if (params.footText !== undefined) order.footText = params.footText;
      if (params.address !== undefined) order.address = params.address;
      if (params.addressCountryId !== undefined) {
        order.addressCountry = { id: params.addressCountryId, objectName: "StaticCountry" };
      }
      if (params.deliveryTerms !== undefined) order.deliveryTerms = params.deliveryTerms;
      if (params.paymentTerms !== undefined) order.paymentTerms = params.paymentTerms;
      if (params.currency !== undefined) order.currency = params.currency;
      if (params.contactPersonId !== undefined) {
        order.contactPerson = { id: params.contactPersonId, objectName: "SevUser" };
      }
      if (params.taxRule !== undefined) order.taxRule = { id: params.taxRule, objectName: "TaxRule" };
      if (params.taxText !== undefined) order.taxText = params.taxText;

      return saveOrder(client, {
        order,
        orderPosSave: params.positions ? params.positions.map((p, i) => toOrderPos(p, positionNumbers[i])) : [],
        orderPosDelete: null,
      });
    },
  },
};

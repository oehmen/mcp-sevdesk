import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { allTools, offerTools } from "../src/tools/index.js";
import type { SevdeskClient } from "../src/client.js";

// Fully mocked: these tests never call the sevDesk API.

type Route = { data?: any; error?: any };

function mockClient(routes: { GET?: Record<string, Route>; POST?: Record<string, Route> }) {
  const GET = vi.fn(async (path: string, _init?: any) => routes.GET?.[path] ?? { error: { message: `unmocked GET ${path}` } });
  const POST = vi.fn(async (path: string, _init?: any) => routes.POST?.[path] ?? { error: { message: `unmocked POST ${path}` } });
  const PUT = vi.fn();
  const DELETE = vi.fn();
  return { client: { GET, POST, PUT, DELETE } as unknown as SevdeskClient, GET, POST, PUT, DELETE };
}

const SEQUENCE_PATH = "/SevSequence/Factory/getByType";
const SAVE_PATH = "/Order/Factory/saveOrder";
const sequenceResponse: Route = { data: { objects: { nextSequence: 1281, format: "AN-%YYYY-%NUMBER" } } };
const saveResponse: Route = { data: { objects: { order: { id: 999, orderNumber: "AN-2026-1281", status: "100" }, orderPos: [{ id: 1 }] } } };

const validCreate = {
  contactId: 123,
  header: "Angebot DevOps Support",
  addressCountryId: 47,
  taxRule: "2" as const,
  taxText: "Steuerfrei - Ausfuhrlieferung",
  positions: [{ name: "Beratung", quantity: 2, price: 1500, unityId: 9, taxRate: 0 }],
};

function createRoutes() {
  return {
    GET: { [SEQUENCE_PATH]: sequenceResponse },
    POST: { [SAVE_PATH]: saveResponse },
  };
}

function draftOffer(overrides: Record<string, any> = {}) {
  return {
    id: "777",
    objectName: "Order",
    orderNumber: "AN-2026-1200",
    orderType: "AN",
    status: "100",
    taxRule: { id: "2", objectName: "TaxRule" },
    ...overrides,
  };
}

function updateRoutes(offer: Record<string, any>, positions: any[] = [{ id: "555", taxRate: "0" }]) {
  return {
    GET: {
      "/Order/{orderId}": { data: { objects: [offer] } },
      "/Order/{orderId}/getPositions": { data: { objects: positions } },
    },
    POST: { [SAVE_PATH]: saveResponse },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
  vi.stubEnv("SEVDESK_CONTACT_PERSON_ID", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Offers: Draft-only-Garantie", () => {
  const forbiddenName = /send|status|delete|book|accept|reject/i;

  it("sollte genau die vier Angebots-Tools registrieren", () => {
    expect(Object.keys(offerTools).sort()).toEqual(["create_offer", "get_offer", "list_offers", "update_offer"]);
  });

  it("sollte kein Order-Tool mit send/status/delete/book/accept/reject registrieren", () => {
    const orderDomain = Object.keys(allTools).filter((n) => /offer|order/i.test(n));
    expect(orderDomain.sort()).toEqual(["create_offer", "get_offer", "list_offers", "update_offer"]);
    for (const name of orderDomain) {
      expect(name).not.toMatch(forbiddenName);
    }
  });

  it("sollte keine Sende-, Status-, Konvertierungs- oder Lösch-Endpunkte referenzieren", () => {
    const source = readFileSync(new URL("../src/tools/offers.ts", import.meta.url), "utf8");
    for (const token of [
      "sendViaEmail",
      "sendBy",
      "changeParameter",
      "changeStatus",
      "createInvoiceFromOrder",
      "createContractNoteFromOrder",
      "client.PUT",
      "client.DELETE",
    ]) {
      expect(source).not.toContain(token);
    }
  });
});

describe("create_offer", () => {
  it("sollte einen Entwurf mit abgerufener Angebotsnummer anlegen", async () => {
    const { client, GET, POST, PUT, DELETE } = mockClient(createRoutes());
    const result = await offerTools.create_offer.handler(client, validCreate);

    expect(GET).toHaveBeenCalledWith(SEQUENCE_PATH, { params: { query: { objectType: "Order", type: "AN" } } });
    expect(POST).toHaveBeenCalledTimes(1);
    const [path, init] = POST.mock.calls[0];
    expect(path).toBe(SAVE_PATH);
    const { order, orderPosSave, orderPosDelete } = init.body;

    expect(order.id).toBeNull();
    expect(order.orderNumber).toBe("AN-2026-1281");
    expect(order.status).toBe(100);
    expect(order.orderType).toBe("AN");
    expect(order.mapAll).toBe(true);
    expect(order.taxRule).toEqual({ id: "2", objectName: "TaxRule" });
    expect(order.taxText).toBe("Steuerfrei - Ausfuhrlieferung");
    expect(order.taxRate).toBe(0);
    expect(order.contact).toEqual({ id: 123, objectName: "Contact" });
    expect(order.contactPerson).toEqual({ id: 389230, objectName: "SevUser" });
    expect(order.addressCountry).toEqual({ id: 47, objectName: "StaticCountry" });
    expect(order.orderDate).toBe("07.10.2026");
    expect(order.currency).toBe("EUR");
    expect(order).not.toHaveProperty("address");
    expect(orderPosDelete).toBeNull();

    expect(orderPosSave).toHaveLength(1);
    orderPosSave.forEach((pos: any, i: number) => {
      expect(pos.objectName).toBe("OrderPos");
      expect(pos.mapAll).toBe(true);
      expect(pos.unity).toEqual({ id: 9, objectName: "Unity" });
      expect(pos.taxRate).toBe(0);
      expect(pos.positionNumber).toBe(i);
      expect(pos.price).toBe("1500");
      expect(pos.part).toBeNull();
      expect(pos).not.toHaveProperty("id");
    });

    expect(result.note).toContain("status 100");
    expect(result.offer).toEqual(saveResponse.data.objects.order);
    expect(PUT).not.toHaveBeenCalled();
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("sollte status, orderNumber und orderType aus der Eingabe ignorieren", async () => {
    const { client, POST } = mockClient(createRoutes());
    await offerTools.create_offer.handler(client, {
      ...validCreate,
      status: 200,
      orderNumber: "AN-1999-1",
      orderType: "AB",
    } as any);
    const { order } = POST.mock.calls[0][1].body;
    expect(order.status).toBe(100);
    expect(order.orderNumber).toBe("AN-2026-1281");
    expect(order.orderType).toBe("AN");
  });

  it("sollte ohne format AN-YYYY-<Nummer> bilden", async () => {
    const routes = createRoutes();
    routes.GET[SEQUENCE_PATH] = { data: { objects: { nextSequence: 1281 } } };
    const { client, POST } = mockClient(routes);
    await offerTools.create_offer.handler(client, validCreate);
    expect(POST.mock.calls[0][1].body.order.orderNumber).toBe("AN-2026-1281");
  });

  it("sollte bei einem SevSequence-Fehler abbrechen, ohne zu speichern", async () => {
    const routes = createRoutes();
    routes.GET[SEQUENCE_PATH] = { error: { message: "boom" } };
    const { client, POST } = mockClient(routes);
    await expect(offerTools.create_offer.handler(client, validCreate)).rejects.toThrow("boom");
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte ohne nextSequence abbrechen, statt eine Nummer zu erfinden", async () => {
    const routes = createRoutes();
    routes.GET[SEQUENCE_PATH] = { data: { objects: { format: "AN-%YYYY-%NUMBER" } } };
    const { client, POST } = mockClient(routes);
    await expect(offerTools.create_offer.handler(client, validCreate)).rejects.toThrow(/sequence/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte bei unbekannten Platzhaltern im format abbrechen", async () => {
    const routes = createRoutes();
    routes.GET[SEQUENCE_PATH] = { data: { objects: { nextSequence: 5, format: "AN-%MM-%NUMBER" } } };
    const { client, POST } = mockClient(routes);
    await expect(offerTools.create_offer.handler(client, validCreate)).rejects.toThrow(/format/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte Inlandsangebote mit 19 % und 7 % akzeptieren", async () => {
    const { client, POST } = mockClient(createRoutes());
    await offerTools.create_offer.handler(client, {
      ...validCreate,
      taxRule: "1",
      taxText: "Umsatzsteuer",
      address: "Kunde GmbH\nStraße 1\n50667 Köln",
      positions: [
        { name: "Beratung", quantity: 1, price: 1000, unityId: 9, taxRate: 19 },
        { name: "Buch", quantity: 1, price: 20, unityId: 1, taxRate: 7, partId: 42 },
      ],
    });
    const { order, orderPosSave } = POST.mock.calls[0][1].body;
    expect(order.taxRate).toBe(19);
    expect(order.taxRule).toEqual({ id: "1", objectName: "TaxRule" });
    expect(order.address).toBe("Kunde GmbH\nStraße 1\n50667 Köln");
    expect(orderPosSave.map((p: any) => p.taxRate)).toEqual([19, 7]);
    expect(orderPosSave[1].part).toEqual({ id: 42, objectName: "Part" });
    expect(orderPosSave[1].positionNumber).toBe(1);
  });

  it("sollte orderDate und Währung übernehmen", async () => {
    const { client, POST } = mockClient(createRoutes());
    await offerTools.create_offer.handler(client, { ...validCreate, orderDate: "2026-11-02", currency: "USD" });
    const { order } = POST.mock.calls[0][1].body;
    expect(order.orderDate).toBe("02.11.2026");
    expect(order.currency).toBe("USD");
  });

  it("sollte contactPersonId aus Eingabe oder Umgebung verwenden", async () => {
    const first = mockClient(createRoutes());
    await offerTools.create_offer.handler(first.client, { ...validCreate, contactPersonId: 42 });
    expect(first.POST.mock.calls[0][1].body.order.contactPerson).toEqual({ id: 42, objectName: "SevUser" });

    vi.stubEnv("SEVDESK_CONTACT_PERSON_ID", "4711");
    const second = mockClient(createRoutes());
    await offerTools.create_offer.handler(second.client, validCreate);
    expect(second.POST.mock.calls[0][1].body.order.contactPerson.id).toBe(4711);
  });

  it("sollte eine unzulässige taxRule/taxRate-Kombination vor jedem API-Aufruf ablehnen", async () => {
    const { client, GET, POST } = mockClient(createRoutes());
    await expect(
      offerTools.create_offer.handler(client, {
        ...validCreate,
        positions: [{ name: "Beratung", quantity: 1, price: 100, unityId: 9, taxRate: 19 }],
      })
    ).rejects.toThrow(/19/);
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte Positionen ohne unityId und leere Positionslisten auch bei direktem Aufruf ablehnen", async () => {
    const { client, GET, POST } = mockClient(createRoutes());
    await expect(
      offerTools.create_offer.handler(client, {
        ...validCreate,
        positions: [{ name: "Beratung", quantity: 1, price: 100, taxRate: 0 }],
      } as any)
    ).rejects.toThrow(/unityId/);
    await expect(offerTools.create_offer.handler(client, { ...validCreate, positions: [] })).rejects.toThrow(/position/);
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  describe("Eingabevalidierung", () => {
    const schema = offerTools.create_offer.inputSchema;
    const position = validCreate.positions[0];

    it("sollte gültige Eingaben akzeptieren", () => {
      expect(schema.safeParse(validCreate).success).toBe(true);
    });

    it.each([
      ["fehlende unityId", { positions: [{ name: "x", quantity: 1, price: 1, taxRate: 0 }] }],
      ["leere Positionsliste", { positions: [] }],
      ["Menge 0", { positions: [{ ...position, quantity: 0 }] }],
      ["taxRule 8", { taxRule: "8" }],
      ["zusätzliches status", { status: 100 }],
      ["zusätzliche orderNumber", { orderNumber: "AN-2026-1" }],
      ["zusätzlicher orderType", { orderType: "AB" }],
      ["fehlender taxText", { taxText: undefined }],
      ["deutsches Datumsformat", { orderDate: "07.10.2026" }],
    ])("sollte %s ablehnen", (_label, override) => {
      expect(schema.safeParse({ ...validCreate, ...override }).success).toBe(false);
    });

    it("sollte limit > 100 bei list_offers ablehnen", () => {
      expect(offerTools.list_offers.inputSchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it("sollte status bei update_offer ablehnen", () => {
      expect(offerTools.update_offer.inputSchema.safeParse({ orderId: 1, status: 200 }).success).toBe(false);
      expect(offerTools.update_offer.inputSchema.safeParse({ orderId: 1, orderNumber: "AN-1" }).success).toBe(false);
      expect(offerTools.update_offer.inputSchema.safeParse({ orderId: 1, headText: "x" }).success).toBe(true);
    });
  });
});

describe("list_offers", () => {
  it("sollte nur Angebote mit Filtern abfragen und zurückgeben", async () => {
    const { client, GET } = mockClient({
      GET: {
        "/Order": {
          data: {
            objects: [
              { id: "1", orderNumber: "AN-2026-1", orderType: "AN", status: "100", header: "A", sumNet: "100", orderDate: "2026-10-01", contact: { id: "123", objectName: "Contact" } },
              { id: "2", orderNumber: "AB-2026-1", orderType: "AB", status: "100", header: "B", sumNet: "50" },
            ],
          },
        },
      },
    });
    const result = await offerTools.list_offers.handler(client, { contactId: 123, status: "100" });

    const [path, init] = GET.mock.calls[0];
    expect(path).toBe("/Order");
    expect(init.params.query).toMatchObject({
      orderType: "AN",
      limit: 20,
      status: 100,
      "contact[id]": 123,
      "contact[objectName]": "Contact",
    });
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      id: "1",
      orderNumber: "AN-2026-1",
      status: "100",
      sumNet: "100",
      header: "A",
      contact: { id: "123", objectName: "Contact" },
    });
  });

  it("sollte ohne contactId keinen Kontaktfilter senden", async () => {
    const { client, GET } = mockClient({ GET: { "/Order": { data: { objects: [] } } } });
    await offerTools.list_offers.handler(client, { limit: 5, offset: 10 });
    const query = GET.mock.calls[0][1].params.query;
    expect(query).toMatchObject({ orderType: "AN", limit: 5, offset: 10 });
    expect(query["contact[id]"]).toBeUndefined();
    expect(query["contact[objectName]"]).toBeUndefined();
  });
});

describe("get_offer", () => {
  it("sollte Angebot und Positionen zurückgeben", async () => {
    const offer = draftOffer();
    const positions = [{ id: "555", name: "Beratung" }];
    const { client, GET, POST } = mockClient(updateRoutes(offer, positions));
    const result = await offerTools.get_offer.handler(client, { orderId: 777 });
    expect(result).toEqual({ offer, positions });
    expect(GET.mock.calls[0][1].params.path.orderId).toBe(777);
    expect(GET.mock.calls[1][0]).toBe("/Order/{orderId}/getPositions");
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte Aufträge ablehnen, die keine Angebote sind", async () => {
    const { client, GET } = mockClient(updateRoutes(draftOffer({ orderType: "AB" })));
    await expect(offerTools.get_offer.handler(client, { orderId: 777 })).rejects.toThrow(/not an offer/);
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("sollte ablehnen, wenn das Angebot nicht existiert", async () => {
    const { client } = mockClient({ GET: { "/Order/{orderId}": { data: { objects: [] } } } });
    await expect(offerTools.get_offer.handler(client, { orderId: 1 })).rejects.toThrow(/not found/);
  });
});

describe("update_offer", () => {
  it.each(["200", "300", "500", "1000"])("sollte ein Angebot mit Status %s ablehnen", async (status) => {
    const { client, POST, PUT, DELETE } = mockClient(updateRoutes(draftOffer({ status })));
    await expect(offerTools.update_offer.handler(client, { orderId: 777, headText: "neu" })).rejects.toThrow(/only draft/);
    expect(POST).not.toHaveBeenCalled();
    expect(PUT).not.toHaveBeenCalled();
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("sollte Aufträge ablehnen, die keine Angebote sind", async () => {
    const { client, POST } = mockClient(updateRoutes(draftOffer({ orderType: "AB" })));
    await expect(offerTools.update_offer.handler(client, { orderId: 777, headText: "neu" })).rejects.toThrow(/not an offer/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte Kopfdaten eines Entwurfs ändern und Status 100 beibehalten", async () => {
    const { client, POST, PUT, DELETE } = mockClient(updateRoutes(draftOffer()));
    const result = await offerTools.update_offer.handler(client, { orderId: 777, headText: "neu", orderDate: "2026-10-09" });
    const [path, init] = POST.mock.calls[0];
    expect(path).toBe(SAVE_PATH);
    const { order, orderPosSave, orderPosDelete } = init.body;
    expect(order).toMatchObject({
      id: 777,
      objectName: "Order",
      mapAll: true,
      status: 100,
      orderType: "AN",
      orderNumber: "AN-2026-1200",
      headText: "neu",
      orderDate: "09.10.2026",
    });
    expect(order).not.toHaveProperty("header");
    expect(order).not.toHaveProperty("taxRule");
    expect(orderPosSave).toEqual([]);
    expect(orderPosDelete).toBeNull();
    expect(result.note).toContain("status 100");
    expect(PUT).not.toHaveBeenCalled();
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("sollte status, orderNumber und orderType aus der Eingabe ignorieren", async () => {
    const { client, POST } = mockClient(updateRoutes(draftOffer()));
    await offerTools.update_offer.handler(client, {
      orderId: 777,
      headText: "neu",
      status: 500,
      orderNumber: "AN-1999-1",
      orderType: "AB",
    } as any);
    const { order } = POST.mock.calls[0][1].body;
    expect(order.status).toBe(100);
    expect(order.orderNumber).toBe("AN-2026-1200");
    expect(order.orderType).toBe("AN");
  });

  it("sollte bestehende Positionen ändern und neue hinzufügen", async () => {
    const { client, POST } = mockClient(updateRoutes(draftOffer()));
    await offerTools.update_offer.handler(client, {
      orderId: 777,
      positions: [
        { id: 555, name: "Beratung", quantity: 3, price: 1200, unityId: 9, taxRate: 0 },
        { name: "Workshop", quantity: 1, price: 2000, unityId: 13, taxRate: 0, positionNumber: 5 },
      ],
    });
    const { orderPosSave, orderPosDelete } = POST.mock.calls[0][1].body;
    expect(orderPosSave[0]).toMatchObject({ id: 555, mapAll: true, unity: { id: 9, objectName: "Unity" }, taxRate: 0, positionNumber: 0 });
    expect(orderPosSave[1]).not.toHaveProperty("id");
    expect(orderPosSave[1]).toMatchObject({ mapAll: true, unity: { id: 13, objectName: "Unity" }, positionNumber: 5 });
    expect(orderPosDelete).toBeNull();
  });

  it("sollte fremde Positions-IDs ablehnen", async () => {
    const { client, POST } = mockClient(updateRoutes(draftOffer()));
    await expect(
      offerTools.update_offer.handler(client, {
        orderId: 777,
        positions: [{ id: 999, name: "x", quantity: 1, price: 1, unityId: 9, taxRate: 0 }],
      })
    ).rejects.toThrow(/999/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte Steuersätze gegen die taxRule des Angebots prüfen", async () => {
    const { client, POST } = mockClient(updateRoutes(draftOffer()));
    await expect(
      offerTools.update_offer.handler(client, {
        orderId: 777,
        positions: [{ name: "x", quantity: 1, price: 1, unityId: 9, taxRate: 19 }],
      })
    ).rejects.toThrow(/taxRule 2/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte eine neue taxRule gegen die bestehenden Positionen prüfen", async () => {
    const { client, POST } = mockClient(updateRoutes(draftOffer({ taxRule: { id: "1" } }), [{ id: "555", taxRate: "19" }]));
    await expect(offerTools.update_offer.handler(client, { orderId: 777, taxRule: "2" })).rejects.toThrow(/19/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sollte ohne Änderungen ablehnen", async () => {
    const { client, GET, POST } = mockClient(updateRoutes(draftOffer()));
    await expect(offerTools.update_offer.handler(client, { orderId: 777 })).rejects.toThrow("Nothing to update");
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });
});

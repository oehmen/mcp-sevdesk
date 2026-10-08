# mcp-sevdesk

Ein MCP (Model Context Protocol) Server für die sevdesk API. Ermöglicht die Integration von sevdesk-Buchhaltungsfunktionen in Claude und andere MCP-kompatible Anwendungen.

## Features

- **Kontakte**: Erstellen, lesen, aktualisieren und löschen von Kontakten (Kunden, Lieferanten, Partner)
- **Rechnungen**: Auflisten, abrufen, als PDF exportieren, per E-Mail versenden, buchen und stornieren
- **Belege (Voucher)**: Verwalten von Eingangsrechnungen und Ausgaben
- **Bankkonten**: Verwalten von Bankkonten und Transaktionen
- **Artikel**: Verwalten von Produkten und Dienstleistungen
- **Angebote (nur Entwürfe)**: Angebote auflisten, abrufen, als Entwurf anlegen und Entwürfe bearbeiten

## Installation

Benötigt Node.js `^20.19` oder `>=22.12` (vite 8 / vitest 4).

```bash
npm install
npm run generate-types
npm run build
```

## Konfiguration

Setze die Umgebungsvariable `SEVDESK_API_TOKEN` mit deinem sevdesk API-Token:

```bash
export SEVDESK_API_TOKEN="dein-32-zeichen-hex-token"
```

Den API-Token findest du in sevdesk unter: Einstellungen → Benutzer → API-Token

Optional legt `SEVDESK_CONTACT_PERSON_ID` den Ansprechpartner (SevUser-ID) fest, den `create_offer` verwendet, wenn kein `contactPersonId` übergeben wird. Ohne die Variable wird `389230` verwendet.

```bash
export SEVDESK_CONTACT_PERSON_ID="389230"
```

## Verwendung

### Als MCP-Server

Füge den Server zu deiner Claude Desktop Konfiguration hinzu (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sevdesk": {
      "command": "node",
      "args": ["/pfad/zu/mcp-sevdesk/dist/index.js"],
      "env": {
        "SEVDESK_API_TOKEN": "dein-api-token"
      }
    }
  }
}
```

### Direkt ausführen

```bash
SEVDESK_API_TOKEN="dein-token" npm start
```

## Verfügbare Tools

### Kontakte

| Tool | Beschreibung |
|------|-------------|
| `list_contacts` | Alle Kontakte auflisten |
| `get_contact` | Einzelnen Kontakt abrufen |
| `create_contact` | Neuen Kontakt erstellen |
| `update_contact` | Kontakt aktualisieren |
| `delete_contact` | Kontakt löschen |

### Rechnungen

| Tool | Beschreibung |
|------|-------------|
| `list_invoices` | Alle Rechnungen auflisten |
| `get_invoice` | Einzelne Rechnung abrufen |
| `get_invoice_pdf` | Rechnung als PDF abrufen |
| `send_invoice_by_email` | Rechnung per E-Mail versenden |
| `mark_invoice_as_sent` | Rechnung als versendet markieren |
| `book_invoice` | Rechnung als bezahlt buchen |
| `cancel_invoice` | Rechnung stornieren |

### Belege (Voucher)

| Tool | Beschreibung |
|------|-------------|
| `list_vouchers` | Alle Belege auflisten |
| `get_voucher` | Einzelnen Beleg abrufen |
| `book_voucher` | Beleg als bezahlt buchen |
| `get_voucher_positions` | Belegpositionen abrufen |
| `upload_voucher_file` | Belegdatei hochladen |

### Bankkonten

| Tool | Beschreibung |
|------|-------------|
| `list_check_accounts` | Alle Bankkonten auflisten |
| `get_check_account` | Einzelnes Bankkonto abrufen |
| `get_check_account_balance` | Kontostand abrufen |
| `list_transactions` | Transaktionen auflisten |
| `get_transaction` | Einzelne Transaktion abrufen |
| `create_transaction` | Neue Transaktion erstellen |

### Artikel

| Tool | Beschreibung |
|------|-------------|
| `list_parts` | Alle Artikel auflisten |
| `get_part` | Einzelnen Artikel abrufen |
| `create_part` | Neuen Artikel erstellen |
| `update_part` | Artikel aktualisieren |
| `get_part_stock` | Lagerbestand abrufen |

### Angebote (nur Entwürfe)

| Tool | Beschreibung |
|------|-------------|
| `list_offers` | Angebote (orderType `AN`) auflisten, filterbar nach Kontakt, Status und Angebotsnummer |
| `get_offer` | Einzelnes Angebot mit Positionen abrufen (lehnt Aufträge ab, die keine Angebote sind) |
| `create_offer` | Neues Angebot als Entwurf (Status 100) anlegen |
| `update_offer` | Angebotsentwurf (Status 100) bearbeiten, inklusive Positionen |

#### Draft-only-Garantie

- `create_offer` legt immer ein Angebot mit Status 100 (Entwurf) an. Die Angebotsnummer (`AN-…`) holt das Tool selbst aus sevDesk (`SevSequence`). Status, Nummer und Typ können nicht übergeben werden.
- `update_offer` liest das Angebot zuerst und lehnt alles ab, was kein Entwurf ist. Status, Nummer und Typ bleiben unverändert. Positionen werden hinzugefügt oder geändert, nie gelöscht.
- Es gibt keine Tools zum Versenden, zum Ändern des Status, zum Annehmen oder Ablehnen, zum Umwandeln in Rechnung oder Auftragsbestätigung und zum Löschen von Angeboten. Diese Schritte bleiben manuell in sevDesk.
- `taxRule` und die `taxRate` jeder Position werden vor dem Speichern geprüft:

  | taxRule | Bedeutung | Erlaubte `taxRate` |
  |---------|-----------|--------------------|
  | `1` | Umsatzsteuerpflichtige Umsätze (Inland) | 0, 7, 19 |
  | `2` | Ausfuhren (Nicht-EU) | 0 |
  | `3` | Innergemeinschaftliche Lieferungen | 0 |
  | `4` | Steuerfreie Umsätze §4 UStG | 0 |
  | `5` | Reverse Charge §13b UStG | 0 |
  | `11` | Steuer nicht erhoben §19 UStG | 0 |

- Ändert `update_offer` die `taxRule`, müssen alle Positionen des Angebots zur neuen Regel passen. Bestehende Positionen mit unpassender `taxRate` lehnt das Tool ab, statt sie umzuschreiben; diese Positionen müssen mit ihrer `id` und einer erlaubten `taxRate` im selben Aufruf mitgeschickt werden.
- `update_offer` behält die `positionNumber` bestehender Positionen bei. Neue Positionen werden nach der höchsten vorhandenen Nummer angehängt. Eine explizit übergebene `positionNumber` hat Vorrang.
- Jede Position braucht eine Einheit (`unityId`, z. B. 1=Stk, 7=pauschal, 9=Std, 13=Tag(e)) und eine Menge größer 0. Ein Angebot braucht mindestens eine Position.

## API-Referenz

Dieser Server basiert auf der offiziellen sevdesk API v1. Weitere Informationen zur API findest du in der [sevdesk API-Dokumentation](https://api.sevdesk.de/).

## Lizenz

MIT

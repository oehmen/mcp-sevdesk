import { contactTools } from "./contacts.js";
import { invoiceTools } from "./invoices.js";
import { voucherTools } from "./vouchers.js";
import { accountTools } from "./accounts.js";
import { partTools } from "./parts.js";
import { tagTools } from "./tags.js";
import { offerTools } from "./offers.js";

export { contactTools } from "./contacts.js";
export { invoiceTools } from "./invoices.js";
export { voucherTools } from "./vouchers.js";
export { accountTools } from "./accounts.js";
export { partTools } from "./parts.js";
export { tagTools } from "./tags.js";
export { offerTools } from "./offers.js";

// Combine all tools
export const allTools = {
  ...contactTools,
  ...invoiceTools,
  ...voucherTools,
  ...accountTools,
  ...partTools,
  ...tagTools,
  ...offerTools,
};

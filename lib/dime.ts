import { z } from "zod";

const day = z.iso.date();
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const decimal = z.string().regex(/^\d{1,10}(?:\.\d{1,8})?$/);
const identifier = z.string().min(1).max(100);
export const fields = {
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),
  option_type: z.enum(["Call", "Put"]),
  strike: decimal,
  expiration: day,
  day,
  clock,
  side: z.enum(["Buy", "Sell", "Sell to open", "Buy to close"]),
  order_type: z.string().min(1).max(60),
  status: z.enum(["filled", "partial", "pending", "cancelled"]),
  quantity: z.number().int().min(1).max(999999),
  price: decimal,
  fill_id: identifier,
  order_id: identifier,
};
export const labels: Record<keyof typeof fields, string> = {
  symbol: "Symbol", option_type: "Call / Put", strike: "Strike", expiration: "Expiry",
  day: "Execution date", clock: "Execution time", side: "Side", order_type: "Order type",
  status: "Status", quantity: "Filled contracts", price: "Fill price (USD)",
  fill_id: "Broker fill ID", order_id: "Broker order ID",
};
export const fieldKeys = Object.keys(fields) as (keyof typeof fields)[];
export const fillSchema = z.object({
  symbol: fields.symbol.nullable(), option_type: fields.option_type.nullable(),
  strike: fields.strike.nullable(), expiration: fields.expiration.nullable(),
  day: fields.day.nullable(), clock: fields.clock.nullable(), side: fields.side.nullable(),
  order_type: fields.order_type.nullable(), status: fields.status.nullable(),
  quantity: fields.quantity.nullable(), price: fields.price.nullable(),
  fill_id: fields.fill_id.nullable(), order_id: fields.order_id.nullable(),
});
export const extractionSchema = z.object({ rows: z.array(fillSchema).max(40) });
export type Fill = z.infer<typeof fillSchema>;
export const requiredFields = ["symbol", "option_type", "strike", "expiration", "day", "clock", "side", "status", "quantity", "price"] as const;
export const missingFields = (row: Fill) => (row.status === "pending" || row.status === "cancelled")
  ? [] : requiredFields.filter((key) => row[key] === null);

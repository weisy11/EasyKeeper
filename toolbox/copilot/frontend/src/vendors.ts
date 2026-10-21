export const VENDORS = ["gemini", "deepseek", "minimax-cn", "minimax", "openai", "custom"] as const;

export type VendorId = (typeof VENDORS)[number];

export const FORMATS = ["chat", "responses", "interactions", "messages"] as const;

export type FormatId = (typeof FORMATS)[number];

const ADDRESSES: Record<Exclude<VendorId, "custom">, Partial<Record<FormatId, string>>> = {
  gemini: {
    chat: "https://generativelanguage.googleapis.com/v1beta/openai",
    interactions: "https://generativelanguage.googleapis.com/v1beta",
  },
  deepseek: {
    chat: "https://api.deepseek.com",
    messages: "https://api.deepseek.com/anthropic",
  },
  "minimax-cn": {
    chat: "https://api.minimax.cn/v1",
    responses: "https://api.minimax.cn/v1",
    messages: "https://api.minimax.cn/anthropic",
  },
  minimax: {
    chat: "https://api.minimax.io/v1",
    responses: "https://api.minimax.io/v1",
    messages: "https://api.minimax.io/anthropic",
  },
  openai: {
    chat: "https://api.openai.com/v1",
    responses: "https://api.openai.com/v1",
  },
};

export function isVendor(value: string): value is VendorId {
  return (VENDORS as readonly string[]).includes(value);
}

export function isFormat(value: string): value is FormatId {
  return (FORMATS as readonly string[]).includes(value);
}

/** Known providers fill this in. Custom stays blank. */
export function addressFor(vendor: string, format: string): string {
  if (!isVendor(vendor) || vendor === "custom" || !isFormat(format)) return "";
  return ADDRESSES[vendor][format] ?? "";
}

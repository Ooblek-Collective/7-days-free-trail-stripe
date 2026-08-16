export type Tier = "guest" | "free" | "trial" | "pro";

export interface MeResponse {
  loggedIn: boolean;
  username: string | null;
  tier: Tier;
  sections: string[];
  msRemaining: number | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  amountPaid: number;
  currency: string;
  status: string;
  created: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

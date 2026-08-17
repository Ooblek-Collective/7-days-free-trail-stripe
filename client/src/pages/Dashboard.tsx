import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Invoice, MeResponse, Tier } from "../types";

const TIER_LABELS: Record<Tier, string> = {
  guest: "Guest",
  free: "Free",
  trial: "Trial",
  pro: "Pro",
};

const TIER_BADGE_CLASSES: Record<Tier, string> = {
  guest: "bg-text-dim/15 text-text-dim",
  free: "bg-text-dim/15 text-[#c7cad1]",
  trial: "bg-teal/15 text-teal",
  pro: "bg-accent/15 text-accent",
};

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m remaining`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s remaining`;
  return `${minutes}m ${seconds}s remaining`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

export default function Dashboard() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [invoicesError, setInvoicesError] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const tickRef = useRef<number | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/me");
    const json: MeResponse = await res.json();
    setData(json);
    setRemaining(json.tier === "trial" ? json.msRemaining : null);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);

    if (data?.tier === "trial") {
      tickRef.current = window.setInterval(() => {
        setRemaining((r) => {
          if (r == null) return r;
          const next = r - 1000;
          if (next <= 0) {
            loadStatus();
            return r;
          }
          return next;
        });
      }, 1000);
    }

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [data?.tier, loadStatus]);

  const loadInvoices = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices");
      const json: Invoice[] = await res.json();
      setInvoices(json);
      setInvoicesError(false);
    } catch {
      setInvoicesError(true);
    }
  }, []);

  useEffect(() => {
    if (data?.loggedIn) {
      loadInvoices();
    } else {
      setInvoices(null);
    }
  }, [data?.loggedIn, loadInvoices]);

  async function handleLogout() {
    await fetch("/logout", { method: "POST" });
    window.location.href = "/index.html";
  }

  async function handleSubscribe() {
    setActionBusy(true);
    try {
      const res = await fetch("/subscribe", { method: "POST" });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
        return;
      }
    } catch {
      // fall through to re-enable the button below
    }
    setActionBusy(false);
  }

  async function handleRefund() {
    setActionBusy(true);
    await fetch("/refund", { method: "POST" });
    await loadStatus();
    setActionBusy(false);
  }

  async function handleUpgrade() {
    setActionBusy(true);
    await fetch("/upgrade", { method: "POST" });
    await loadStatus();
    setActionBusy(false);
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-bg text-text">
        <Header loggedIn={false} username={null} onLogout={handleLogout} />
        <main className="max-w-[760px] mx-auto px-6 pt-8 pb-16">
          <div className="bg-panel border border-panel-border rounded-[10px] p-6">
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold py-1.5 px-3 rounded-full uppercase tracking-wide bg-text-dim/15 text-text-dim">
              Loading…
            </span>
          </div>
        </main>
      </div>
    );
  }

  const sections = data.sections;
  const trialUnlocked = sections.includes("trial");
  const proUnlocked = sections.includes("pro");

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header loggedIn={data.loggedIn} username={data.username} onLogout={handleLogout} />

      <main className="max-w-[760px] mx-auto px-6 pt-8 pb-16">
        <div className="bg-panel border border-panel-border rounded-[10px] p-6 mb-7">
          <div className="flex items-center justify-between flex-wrap gap-3.5">
            <span
              className={`inline-flex items-center gap-2 text-[13px] font-semibold py-1.5 px-3 rounded-full uppercase tracking-wide ${TIER_BADGE_CLASSES[data.tier]}`}
            >
              {TIER_LABELS[data.tier]}
            </span>
            {data.tier === "trial" && remaining != null && (
              <div className="text-[13px] text-text-dim">
                <strong className="text-text tabular-nums">
                  {formatRemaining(remaining)}
                </strong>
              </div>
            )}
          </div>

          <div className="flex gap-1.5 mt-4">
            {["public", "trial", "pro"].map((key) => (
              <div
                key={key}
                className={`flex-1 h-[5px] rounded-full ${sections.includes(key) ? "bg-accent" : "bg-locked"}`}
              />
            ))}
          </div>

          <div className="mt-[18px] flex gap-2.5 flex-wrap">
            {!data.loggedIn ? null : data.tier === "free" ? (
              <button
                onClick={handleSubscribe}
                disabled={actionBusy}
                className="border-none rounded-md text-[13.5px] font-semibold py-2.5 px-4 cursor-pointer bg-accent text-bg disabled:opacity-50 disabled:cursor-default"
              >
                {actionBusy ? "Redirecting to Stripe…" : "Start 7-day trial - $199"}
              </button>
            ) : data.tier === "trial" ? (
              <>
                <button
                  onClick={handleUpgrade}
                  disabled={actionBusy}
                  className="border-none rounded-md text-[13.5px] font-semibold py-2.5 px-4 cursor-pointer bg-accent text-bg disabled:opacity-50 disabled:cursor-default"
                >
                  {actionBusy ? "Upgrading…" : "Upgrade to Pro now"}
                </button>
                <button
                  onClick={handleRefund}
                  disabled={actionBusy}
                  className="rounded-md text-[13.5px] font-semibold py-2.5 px-4 cursor-pointer bg-transparent border border-danger/40 text-danger disabled:opacity-50 disabled:cursor-default"
                >
                  {actionBusy ? "Processing…" : "Request refund"}
                </button>
              </>
            ) : (
              <button
                onClick={handleRefund}
                disabled={actionBusy || data.cancelAt != null}
                className="rounded-md text-[13.5px] font-semibold py-2.5 px-4 cursor-pointer bg-transparent border border-danger/40 text-danger disabled:opacity-50 disabled:cursor-default"
              >
                {data.cancelAt != null
                  ? "Cancellation scheduled"
                  : actionBusy
                    ? "Processing…"
                    : "Cancel subscription"}
              </button>
            )}
          </div>

          <div className="text-xs text-text-dim mt-2.5">
            {!data.loggedIn
              ? "You are browsing as a guest - only the public section is visible."
              : data.tier === "free"
                ? "You'll be redirected to Stripe to pay $199 and start your 7-day refund window."
                : data.tier === "trial"
                  ? "Upgrading unlocks the Pro section right away and starts a fresh billing month from today, so your next charge moves up to 30 days from now instead of waiting out the trial - but it forfeits your refund. Refunding keeps that option by staying in the trial instead."
                  : data.tier === "pro"
                    ? data.cancelAt != null
                      ? `Your subscription will be canceled on ${formatDate(data.cancelAt)}. You'll keep Pro access until then, and won't be charged again.`
                      : "You are on Pro, so no refund - but you can cancel to stop future renewals. Access stays on through the period you already paid for."
                    : ""}
          </div>
        </div>

        <Section title="Public section" tag="All users" locked={false}>
          Visible to everyone, including guests who aren't logged in. General
          product info, docs, whatever's meant to be open.
        </Section>

        <Section
          title="Trial section"
          tag="Trial + Pro"
          locked={!trialUnlocked}
          lockNote={
            trialUnlocked
              ? ""
              : data.loggedIn
                ? "Start the trial below to unlock this."
                : "Sign in and start a trial to unlock this."
          }
        >
          Unlocked once you start the 7-day trial. This is the "limited" tier
          of the paid plan.
        </Section>

        <Section
          title="Pro section"
          tag="Pro only"
          locked={!proUnlocked}
          lockNote={proUnlocked ? "" : "Unlocks 7 days after starting the trial."}
        >
          Full access. Unlocks automatically once the first 7 days pass
          without a refund, and continues through a full pro month. After
          that your subscription renews automatically each month at $199
          until you cancel.
        </Section>

        {data.loggedIn && (
          <section className="border border-panel-border rounded-[10px] p-5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] m-0">Invoices</h2>
              <span className="text-[11px] text-text-dim border border-panel-border rounded px-1.5 py-0.5">
                From Stripe
              </span>
            </div>
            <InvoiceList invoices={invoices} error={invoicesError} />
          </section>
        )}
      </main>
    </div>
  );
}

function Header({
  loggedIn,
  username,
  onLogout,
}: {
  loggedIn: boolean;
  username: string | null;
  onLogout: () => void;
}) {
  return (
    <header className="flex items-center justify-between py-4 px-7 border-b border-panel-border">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center font-bold text-[13px] text-bg">
          A
        </div>
        <div className="font-semibold text-[14.5px]">Access Demo</div>
      </div>
      <div className="flex items-center gap-3 text-[13.5px] text-text-dim">
        {loggedIn ? (
          <>
            <span>{username}</span>
            <button
              onClick={onLogout}
              className="bg-transparent border border-panel-border text-text-dim py-1.5 px-3 rounded-md text-[13px] cursor-pointer hover:text-text hover:border-text-dim"
            >
              Log out
            </button>
          </>
        ) : (
          <a
            href="/index.html"
            className="bg-accent text-bg no-underline inline-block py-1.5 px-3 rounded-md text-[13px] font-semibold"
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

function Section({
  title,
  tag,
  locked,
  lockNote,
  children,
}: {
  title: string;
  tag: string;
  locked: boolean;
  lockNote?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`border border-panel-border rounded-[10px] p-5 mb-4 relative ${locked ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[15px] m-0">{title}</h2>
        <span className="text-[11px] text-text-dim border border-panel-border rounded px-1.5 py-0.5">
          {tag}
        </span>
      </div>
      <p className="text-[13.5px] text-text-dim m-0 leading-relaxed">{children}</p>
      {lockNote && <div className="text-[12.5px] text-text-dim mt-2">{lockNote}</div>}
    </section>
  );
}

function InvoiceList({
  invoices,
  error,
}: {
  invoices: Invoice[] | null;
  error: boolean;
}) {
  if (error) {
    return <div className="text-[13px] text-text-dim">Could not load invoices.</div>;
  }
  if (invoices == null) return null;
  if (invoices.length === 0) {
    return <div className="text-[13px] text-text-dim">No invoices yet.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {invoices.map((inv) => {
        const amount = (inv.amountPaid / 100).toLocaleString(undefined, {
          style: "currency",
          currency: inv.currency.toUpperCase(),
        });
        const date = new Date(inv.created).toLocaleDateString();
        return (
          <div
            key={inv.id}
            className="flex items-center justify-between gap-3 py-2.5 border-b border-panel-border last:border-b-0 text-[13px]"
          >
            <div className="flex flex-col gap-0.5">
              <span className="tabular-nums">
                {amount} &middot; {date}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-text-dim">
                {inv.status}
              </span>
            </div>
            {inv.hostedInvoiceUrl && (
              <a
                href={inv.hostedInvoiceUrl}
                target="_blank"
                rel="noopener"
                className="text-accent text-[12.5px] no-underline hover:underline"
              >
                View
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

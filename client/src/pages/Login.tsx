import { useState, type FormEvent } from "react";

type Mode = "login" | "register";

const COPY: Record<
  Mode,
  { title: string; sub: string; submit: string; toggleText: string; toggleLink: string }
> = {
  login: {
    title: "Sign in",
    sub: "Guests, free, trial and pro all land on the same dashboard - what they see there depends on this login.",
    submit: "Sign in",
    toggleText: "Don't have an account?",
    toggleLink: "Create one",
  },
  register: {
    title: "Create your account",
    sub: "Starts on the free tier. You can start a trial from the dashboard.",
    submit: "Create account",
    toggleText: "Already have an account?",
    toggleLink: "Sign in",
  },
};

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const copy = COPY[mode];

  function toggleMode() {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const endpoint = mode === "login" ? "/login" : "/register";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setSubmitting(false);
        return;
      }

      window.location.href = "/dashboard.html";
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-bg text-text p-6"
      style={{
        backgroundImage:
          "radial-gradient(circle at 15% 20%, rgba(224,165,39,0.07), transparent 40%), radial-gradient(circle at 85% 80%, rgba(224,165,39,0.05), transparent 45%)",
      }}
    >
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-7">
          <div className="w-[30px] h-[30px] rounded-lg bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center font-bold text-sm text-bg">
            A
          </div>
          <div className="font-semibold tracking-wide">Access Demo</div>
        </div>

        <div className="bg-panel border border-panel-border rounded-[10px] p-7">
          <h1 className="text-[19px] m-0 mb-1">{copy.title}</h1>
          <p className="text-text-dim text-[13.5px] mt-0 mb-[22px]">{copy.sub}</p>

          <form onSubmit={handleSubmit}>
            <label
              htmlFor="username"
              className="block text-[12.5px] text-text-dim mt-3.5 mb-1.5"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#101216] border border-panel-border rounded-md text-text text-sm outline-none focus:border-accent transition-colors"
            />

            <label
              htmlFor="password"
              className="block text-[12.5px] text-text-dim mt-3.5 mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#101216] border border-panel-border rounded-md text-text text-sm outline-none focus:border-accent transition-colors"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-[18px] bg-accent text-bg rounded-md text-sm font-semibold py-[11px] px-3.5 cursor-pointer transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
            >
              {submitting
                ? mode === "login"
                  ? "Signing in…"
                  : "Creating account…"
                : copy.submit}
            </button>
          </form>

          {error && (
            <div className="mt-3.5 text-sm px-2.5 py-2 rounded-md bg-danger/10 text-danger border border-danger/30">
              {error}
            </div>
          )}

          <div className="mt-[18px] text-center text-[13px] text-text-dim">
            <span>{copy.toggleText} </span>
            <a
              onClick={toggleMode}
              className="text-accent no-underline cursor-pointer hover:underline"
            >
              {copy.toggleLink}
            </a>
          </div>

          <div className="mt-5 flex gap-1.5 text-[11px] text-text-dim">
            {["Free", "Trial", "Pro"].map((label) => (
              <span
                key={label}
                className="flex-1 text-center py-1 border border-panel-border rounded"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-ink-300 rounded-lg p-8 space-y-5"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Northwest Guitars</h1>
          <p className="text-sm text-ink-500 mt-1">Sign in to view the dashboard</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-ink-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink-700"
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-ink-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink-700"
              autoComplete="current-password"
            />
          </label>
        </div>

        {error && (
          <div className="text-sm text-bad bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink-900 text-white text-sm font-medium rounded px-3 py-2 hover:bg-ink-700 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

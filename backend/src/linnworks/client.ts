import { request } from "undici";
import { env } from "../env.js";

const AUTH_HOST = "https://api.linnworks.net";

type Session = { token: string; server: string };

let cachedSession: Session | null = null;
let inflightAuth: Promise<Session> | null = null;

async function authorize(): Promise<Session> {
  const body = new URLSearchParams({
    ApplicationId: env.LINNWORKS_APPLICATION_ID,
    ApplicationSecret: env.LINNWORKS_APPLICATION_SECRET,
    Token: env.LINNWORKS_TOKEN,
  });

  const { statusCode, body: resBody } = await request(
    `${AUTH_HOST}/api/Auth/AuthorizeByApplication`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );

  const text = await resBody.text();
  if (statusCode !== 200) {
    throw new Error(`Linnworks auth failed (${statusCode}): ${text}`);
  }

  const json = JSON.parse(text) as { Token: string; Server: string };
  if (!json.Token || !json.Server) {
    throw new Error(`Linnworks auth response missing Token/Server: ${text}`);
  }

  if (env.LINNWORKS_DEBUG) {
    console.log("[linnworks] auth ok, server=", json.Server);
  }

  return { token: json.Token, server: json.Server.replace(/\/+$/, "") };
}

async function getSession(forceRefresh = false): Promise<Session> {
  if (!forceRefresh && cachedSession) return cachedSession;
  if (inflightAuth) return inflightAuth;

  inflightAuth = authorize()
    .then((s) => {
      cachedSession = s;
      return s;
    })
    .finally(() => {
      inflightAuth = null;
    });

  return inflightAuth;
}

function encodeParams(params: Record<string, unknown>): string {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      form.append(k, JSON.stringify(v));
    } else {
      form.append(k, String(v));
    }
  }
  return form.toString();
}

export async function linnworksRequest<T = unknown>(
  path: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const body = encodeParams(params);

  if (env.LINNWORKS_DEBUG) {
    console.log(`[linnworks] POST ${path}`);
    console.log(`[linnworks] body: ${body}`);
  }

  const send = async (session: Session) => {
    const url = `${session.server}/api/${path.replace(/^\/+/, "")}`;
    return request(url, {
      method: "POST",
      headers: {
        Authorization: session.token,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
  };

  let session = await getSession();
  let res = await send(session);

  if (res.statusCode === 401) {
    if (env.LINNWORKS_DEBUG) console.log("[linnworks] 401, re-authing");
    session = await getSession(true);
    res = await send(session);
  }

  const text = await res.body.text();

  if (env.LINNWORKS_DEBUG) {
    const truncated = text.length > 4000 ? `${text.slice(0, 4000)}…(+${text.length - 4000} chars)` : text;
    console.log(`[linnworks] ← ${res.statusCode} ${truncated}`);
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Linnworks ${path} failed (${res.statusCode}): ${text}`);
  }

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

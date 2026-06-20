import { csrfToken, parseForms } from "./html.js";

export type TekmarClientOptions = {
  baseUrl?: string;
  login?: string;
  password?: string;
  sessionCookie?: string;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: URLSearchParams;
  headers?: HeadersInit;
};

export class TekmarClient {
  readonly baseUrl: string;
  private cookies = new Map<string, string>();
  private login?: string;
  private password?: string;

  constructor(options: TekmarClientOptions = {}) {
    const baseUrl = options.baseUrl ?? env("TEKMAR_BASE_URL");
    if (!baseUrl) throw new Error("TEKMAR_BASE_URL is required.");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.login = options.login ?? env("TEKMAR_LOGIN");
    this.password = options.password ?? env("TEKMAR_PASSWORD");
    const sessionCookie = options.sessionCookie ?? env("TEKMAR_SESSION_COOKIE");
    if (sessionCookie) this.storeCookie(sessionCookie);
  }

  async get(path: string): Promise<string> {
    return this.request(path, { method: "GET" });
  }

  async post(path: string, body: URLSearchParams): Promise<string> {
    return this.request(path, { method: "POST", body });
  }

  async put(path: string, body: URLSearchParams): Promise<string> {
    body.set("_method", "put");
    return this.request(path, { method: "POST", body });
  }

  async ensureAuthenticated(): Promise<void> {
    const response = await this.rawFetch("/");
    const location = response.headers.get("location");
    if (!location?.includes("/sessions/new")) return;
    if (!this.login || !this.password) {
      throw new Error("Authentication required. Set TEKMAR_LOGIN/TEKMAR_PASSWORD or TEKMAR_SESSION_COOKIE.");
    }
    await response.text();
    const loginPage = await this.get("/sessions/new");
    const token = csrfToken(loginPage);
    if (!token) throw new Error("Could not find login authenticity_token.");
    const body = new URLSearchParams({
      utf8: "✓",
      _method: "put",
      authenticity_token: token,
      login: this.login,
      password: this.password,
    });
    const html = await this.post("/sessions/login", body);
    if (html.includes("/sessions/new") && html.includes("password")) {
      throw new Error("Login appears to have failed.");
    }
  }

  async csrfFor(path: string): Promise<string> {
    const html = await this.get(path);
    const token = csrfToken(html);
    if (!token) throw new Error(`Could not find authenticity_token on ${path}.`);
    return token;
  }

  async formFor(path: string, predicate: (action: string) => boolean = () => true) {
    const html = await this.get(path);
    const form = parseForms(html).find((candidate) => predicate(candidate.action || path));
    if (!form) throw new Error(`Could not find matching form on ${path}.`);
    return { html, form };
  }

  private async request(path: string, options: RequestOptions): Promise<string> {
    const response = await this.rawFetch(path, options);
    const text = await response.text();
    if (response.status >= 400) throw new Error(`${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
    return text;
  }

  private async rawFetch(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const headers = new Headers(options.headers);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
    const response = await fetch(url, {
      method: options.method ?? "GET",
      body: options.body,
      headers,
      redirect: "manual",
    });
    response.headers.getSetCookie?.().forEach((cookie) => this.storeCookie(cookie));
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.storeCookie(setCookie);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location && !location.includes("/sessions/new")) return this.rawFetch(location, { method: "GET" });
    }
    return response;
  }

  private storeCookie(header: string): void {
    for (const part of header.split(/,(?=\s*[^;,=]+=[^;,]+)/)) {
      const [pair] = part.trim().split(";");
      const equals = pair?.indexOf("=") ?? -1;
      if (!pair || equals < 0) continue;
      this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
  }
}

function env(name: string): string | undefined {
  return globalThis.Bun?.env[name] ?? process.env[name];
}

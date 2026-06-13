export type FormControl = {
  tag: string;
  type?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  options?: Array<{ value: string; text: string; selected: boolean }>;
};

export type HtmlForm = {
  id?: string;
  action: string;
  method: string;
  controls: FormControl[];
};

export type Link = {
  text: string;
  href: string;
};

export function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2713;/g, "✓")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function stripTags(input: string): string {
  return decodeHtml(input.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function attr(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match ? decodeHtml(match[2] ?? match[3] ?? match[4] ?? "") : undefined;
}

export function parseLinks(html: string): Link[] {
  const links: Link[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1] ?? "", "href");
    const text = stripTags(match[2] ?? "");
    if (href && text) links.push({ href, text });
  }
  return links;
}

export function parseForms(html: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  for (const formMatch of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formTag = formMatch[1] ?? "";
    const body = formMatch[2] ?? "";
    const controls: FormControl[] = [];

    for (const inputMatch of body.matchAll(/<input\b([^>]*)>/gi)) {
      const tag = inputMatch[1] ?? "";
      controls.push({
        tag: "input",
        type: attr(tag, "type") ?? "text",
        name: attr(tag, "name"),
        value: attr(tag, "value") ?? "",
        checked: /\bchecked\b/i.test(tag),
      });
    }

    for (const selectMatch of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const selectTag = selectMatch[1] ?? "";
      const selectBody = selectMatch[2] ?? "";
      const options = [...selectBody.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((optionMatch) => {
        const optionTag = optionMatch[1] ?? "";
        const text = stripTags(optionMatch[2] ?? "");
        return {
          value: attr(optionTag, "value") ?? text,
          text,
          selected: /\bselected\b/i.test(optionTag),
        };
      });
      controls.push({
        tag: "select",
        type: "select-one",
        name: attr(selectTag, "name"),
        value: options.find((option) => option.selected)?.value ?? options[0]?.value ?? "",
        options,
      });
    }

    for (const textareaMatch of body.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const textareaTag = textareaMatch[1] ?? "";
      controls.push({
        tag: "textarea",
        type: "textarea",
        name: attr(textareaTag, "name"),
        value: decodeHtml(textareaMatch[2] ?? ""),
      });
    }

    forms.push({
      id: attr(formTag, "id"),
      action: attr(formTag, "action") ?? "",
      method: (attr(formTag, "method") ?? "get").toLowerCase(),
      controls,
    });
  }
  return forms;
}

export function parseTables(html: string): string[][][] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((tableMatch) => {
    const table = tableMatch[1] ?? "";
    return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => {
      const row = rowMatch[1] ?? "";
      return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) => stripTags(cellMatch[1] ?? ""));
    });
  });
}

export function csrfToken(html: string): string | undefined {
  return parseForms(html)
    .flatMap((form) => form.controls)
    .find((control) => control.name === "authenticity_token")?.value;
}

export function formBody(form: HtmlForm, overrides: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const control of form.controls) {
    if (!control.name) continue;
    if ((control.type === "checkbox" || control.type === "radio") && !control.checked && !(control.name in overrides)) continue;
    body.append(control.name, overrides[control.name] ?? control.value ?? "");
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!body.has(key)) body.append(key, value);
  }
  return body;
}


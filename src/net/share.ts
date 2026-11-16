export function roomIdFromHash(hash: string): string | null {
  const path = hash.replace(/^#/, "") || "/";
  const match = path.match(/^\/r\/([A-Za-z0-9]+)$/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export function roomShareUrl(roomId: string, pageUrl = location.href): string {
  const url = new URL(pageUrl);
  url.hash = `/r/${roomId.toUpperCase()}`;
  return url.toString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.append(input);
  input.select();
  const ok = document.execCommand("copy");
  input.remove();
  return ok;
}

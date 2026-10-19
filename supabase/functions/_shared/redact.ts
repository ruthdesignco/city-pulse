// Scrub the 511 key from any text bound for a log or ingest_runs. Covers the
// raw and URL-encoded key, plus any api_key= query value even when it isn't
// this key: a rotated or mistyped key is still a secret.
export function redact(text: string, secret: string | undefined): string {
  let out = text
  if (secret) out = out.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]')
  return out.replace(/(api_key=)[^&\s"'<>]+/gi, '$1[redacted]')
}

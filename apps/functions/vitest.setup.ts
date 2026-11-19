// Test-only HMAC secrets. Production reads these from Functions secrets
// with no fallback (PFL-169); tests need deterministic values of the
// required length.
for (const name of ["PROOFLINE_AUTH_JWT_SECRET", "BILATERAL_JWT_SECRET", "COSIGN_REFRESH_SECRET"]) {
  if (!process.env[name]) process.env[name] = `test-${name.toLowerCase()}-0123456789abcdef`;
}

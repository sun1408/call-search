// Single source of the Content-Security-Policy: the build writes it into index.html and the
// service worker attaches it to the HTML and worker-script responses it serves.
// connect-src: this site, Hugging Face (model files) and its download CDN (*.hf.co). Nothing else.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https://huggingface.co https://*.hf.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export const MODEL_HOSTS = ['huggingface.co', '*.hf.co'];

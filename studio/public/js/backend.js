// Picks where Studio runs. The web-hosted build marks its page with <meta name="studio-backend" content="web">;
// otherwise this is the local Studio server.
import { backend as local } from "./backend-server.js";
import { backend as web } from "./backend-web.js";
export async function pickBackend() {
  return document.querySelector('meta[name="studio-backend"]')?.content === "web" ? web : local;
}

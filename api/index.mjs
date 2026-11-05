import { handleRequest } from "../scripts/server.mjs";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const url = req.url || "/";
  if (!url.startsWith("/") && !url.startsWith("http")) {
    req.url = `/${url}`;
  }
  await handleRequest(req, res);
}

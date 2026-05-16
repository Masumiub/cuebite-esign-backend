import { app } from "../src/app.js"

// Vercel's @vercel/node runtime accepts a Node request handler as the default
// export. An Express app *is* such a handler — Vercel just invokes it.
export default app

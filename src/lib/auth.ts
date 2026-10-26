import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { authPool } from "./db";
import { PostgresDialect } from "kysely";
import { authSecret } from "./runtime-secret";

const baseURL = process.env.CURATOR_BASE_URL ?? "http://localhost:3000";
const configuredOrigins = (process.env.CURATOR_TRUSTED_ORIGINS ?? baseURL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Better Auth lazily initializes adapter AsyncLocalStorage. Gate that first
// initialization so concurrent cold signups cannot replace each other's store
// and accidentally run queries outside their signup transaction.
let adapterContextReady: Promise<unknown> | undefined;
export const auth = betterAuth({
  appName: "Instagram Curator",
  baseURL,
  trustedOrigins: [baseURL, "http://127.0.0.1:3000", ...configuredOrigins],
  secret: authSecret(),
  database: {dialect:new PostgresDialect({pool:authPool}),type:"postgres",transaction:true},
  emailAndPassword: {
    enabled: true,
    // Four characters keeps local development accounts simple. The setup
    // wizard will require stronger production credentials before release.
    minPasswordLength: 4,
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      await (adapterContextReady ??= getCurrentAdapter(context.context.adapter));
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          if (!context) throw new APIError("FORBIDDEN",{message:"User creation requires an authenticated endpoint context"});
          const adapter = await getCurrentAdapter(context.context.adapter);
          const count = await adapter.count({model:"user"});
          const adminCreation = context?.path === "/admin/create-user";
          if (count > 0 && !adminCreation) {
            throw new APIError("FORBIDDEN", { message: "El registro público está cerrado" });
          }
          return { data: { ...user, role: count === 0 ? "admin" : "user" } };
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;

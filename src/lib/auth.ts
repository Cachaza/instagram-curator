import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { db } from "./db";
import { authSecret } from "./runtime-secret";

const baseURL = process.env.CURATOR_BASE_URL ?? "http://localhost:3000";
const configuredOrigins = (process.env.CURATOR_TRUSTED_ORIGINS ?? baseURL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const auth = betterAuth({
  appName: "Instagram Curator",
  baseURL,
  trustedOrigins: [baseURL, "http://127.0.0.1:3000", ...configuredOrigins],
  secret: authSecret(),
  database: db,
  emailAndPassword: {
    enabled: true,
    // Four characters keeps local development accounts simple. The setup
    // wizard will require stronger production credentials before release.
    minPasswordLength: 4,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          const count = (db.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }).count;
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

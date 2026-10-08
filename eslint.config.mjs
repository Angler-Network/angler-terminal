import { FlatCompat } from "@eslint/eslintrc";

// Next's own rules (core web vitals, React hooks, TypeScript), the ones the code's eslint-disable comments refer to.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts", "scripts/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // A leading underscore marks a value dropped on purpose (`const { secret: _secret, ...rest } = record`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // Token, venue and news icons come from many hosts; next/image would route every one through the optimizer.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;

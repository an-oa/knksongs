import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
    {
        ignores: [
            "node_modules/**",
            "coverage/**",
            "playwright-report/**",
            "test-results/**",
            "_site/**",
            "_build/**"
        ]
    },
    js.configs.recommended,
    {
        files: ["app/**/*.mts"],
        extends: [tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2024
            }
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "after-used",
                    caughtErrors: "none",
                    ignoreRestSiblings: true
                }
            ]
        }
    },
    {
        files: [
            "eslint.config.mjs",
            "playwright.config.mjs"
        ],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2024
            }
        }
    },
    {
        files: ["scripts/**/*.mts"],
        extends: [tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2024
            }
        }
    },
    {
        files: ["tests/**/*.mts"],
        extends: [tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2024
            }
        }
    },
    {
        // 型情報を使う規則。await も catch もしていない Promise を検出する。
        // 完了を待たない呼び出しは void を付けて意図を示し、失敗し得るものは catch で記録する。
        files: ["app/**/*.mts", "scripts/**/*.mts", "tests/**/*.mts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            "@typescript-eslint/no-floating-promises": "error"
        }
    },
    {
        // node:test の test() は Promise を返すが、完了は test runner が待つので、呼び出しごとに待たなくてよい。
        files: ["tests/**/*.mts"],
        rules: {
            "@typescript-eslint/no-floating-promises": [
                "error",
                {
                    allowForKnownSafeCalls: [{ from: "package", name: "test", package: "node:test" }]
                }
            ]
        }
    }
]);

import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
    // Base recomendada de typescript-eslint (sin type-checking) en ERROR:
    // no-unused-vars, no-explicit-any laxos fuera; ver overrides abajo.
    ...typescriptEslint.configs.recommended,
    {
        files: ["**/*.ts"],

        languageOptions: {
            parser: typescriptEslint.parser,
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {
                // Type-aware linting: resuelve cada fichero contra su proyecto
                // (tsconfig.json para el host, tsconfig.webview.json para el cliente).
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },

        rules: {
            "@typescript-eslint/naming-convention": ["warn", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],

            curly: "error",
            eqeqeq: "error",
            "no-throw-literal": "error",
            semi: "error",

            // Las reglas de promesas son las que cazan las carreras reales
            // (listener async sin await, promesa perdida en un handler).
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": ["error", {
                // Los listeners de VS Code y del DOM aceptan handlers void;
                // pasarles uno async es idiomático aquí (el error se traga el
                // handler, no el listener) — lo prohibido es perder la promesa.
                checksVoidReturn: false,
            }],
            "@typescript-eslint/await-thenable": "error",

            // El codebase interopera con APIs `any` (git extension, postMessage):
            // aviso, no error, para no forzar casts ruidosos de golpe.
            "@typescript-eslint/no-explicit-any": "warn",

            // `_` como prefijo de descarte (convención ya usada en el código).
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrors: "none",
            }],
        },
    },
    {
        // El config de eslint y el script de build no son parte de ningún tsconfig.
        ignores: ["dist/**", "out/**", "esbuild.js", "eslint.config.mjs", ".vscode-test/**"],
    },
);

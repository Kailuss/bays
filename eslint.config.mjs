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

            // ERROR y no aviso. Lo que este codebase lee de fuera —el API de la
            // extensión de git, el packageJSON de otra extensión, el JSON de un
            // tema de iconos— pide `unknown`, no `any`: `unknown` no se puede
            // leer sin comprobarlo antes, así que obliga a que la comprobación
            // exista, mientras que `any` deja que falte y compile. Un warning
            // permanente acaba en warning que nadie lee.
            "@typescript-eslint/no-explicit-any": "error",

            // `_` como prefijo de descarte (convención ya usada en el código).
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrors: "none",
            }],
        },
    },
    {
        // La suite pura: `test()` de node:test devuelve una promesa que gestiona
        // el runner, así que la regla de promesas perdidas reporta cada caso.
        files: ["src/test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-floating-promises": "off",
        },
    },
    {
        // El config de eslint y el script de build no son parte de ningún tsconfig.
        ignores: ["dist/**", "out/**", "esbuild.js", "eslint.config.mjs", ".vscode-test/**"],
    },
);

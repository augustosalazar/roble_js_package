import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

/**
 * Este paquete es TypeScript a secas: no hay React, ni JSX, ni un solo `.tsx`.
 *
 * Antes extendía `@react-native/eslint-config` a través de `FlatCompat`, herencia
 * de la plantilla con la que se creó. Además de sobrar, no funcionaba: los
 * plugins que ese config declara quedan instalados dentro de su propia carpeta,
 * y la configuración plana los busca desde la raíz del proyecto. `eslint` fallaba
 * con «couldn't find the plugin eslint-plugin-react-native» antes de leer una
 * sola línea de código, así que el `lint` del pre-commit no comprobaba nada.
 */
export default defineConfig([
  {
    ignores: ['node_modules/', 'lib/', 'example/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: { prettier },
    rules: {
      'prettier/prettier': 'error',

      // El servidor devuelve filas que define quien usa el paquete, así que su
      // forma no se puede saber aquí. `any` en esos sitios es la descripción
      // honesta del contrato, no una dejadez.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Las pruebas usan los globales de Jest.
    files: ['src/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
]);

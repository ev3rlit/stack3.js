/// <reference types="vite/client" />
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import release from '@jitl/quickjs-wasmfile-release-sync';
import wasmLocation from '@jitl/quickjs-wasmfile-release-sync/wasm?url';

export const createScriptEngine = () => newQuickJSWASMModuleFromVariant(newVariant(release, { wasmLocation }));

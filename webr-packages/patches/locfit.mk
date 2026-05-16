# locfit requests C17, but the current rwasm profile does not override the C17
# compiler variables. Keep this package on Emscripten for browser-compatible wasm.
CC = emcc
CFLAGS = -std=gnu17 $(WASM_COMMON_FLAGS)
CC17 = emcc
C17FLAGS = -std=gnu17 $(WASM_COMMON_FLAGS)
SHLIB_LD = emcc

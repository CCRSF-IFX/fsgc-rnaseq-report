# Appended to rwasm's webR user Makevars before package compilation.
# locfit requests C17, and R reads these variables before package Makevars.
CC17 = emcc
C17FLAGS = -std=gnu17 $(WASM_COMMON_FLAGS)

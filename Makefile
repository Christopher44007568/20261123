CXX ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -Wpedantic
CPPFLAGS ?= -Isrc

CORE_SOURCES = src/scene.cpp src/deep_shadow.cpp src/render.cpp src/validation.cpp
APP_SOURCES = src/main.cpp $(CORE_SOURCES)
TEST_SOURCES = tests/core_tests.cpp $(CORE_SOURCES)

.PHONY: all test run quick clean

all: build/deep_shadow build/core_tests

build:
	mkdir -p build

build/deep_shadow: $(APP_SOURCES) | build
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $(APP_SOURCES) -o $@

build/core_tests: $(TEST_SOURCES) | build
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $(TEST_SOURCES) -o $@

test: build/core_tests
	./build/core_tests

run: build/deep_shadow
	./build/deep_shadow --out out

quick: build/deep_shadow
	./build/deep_shadow --quick --out out

clean:
	rm -rf build out
